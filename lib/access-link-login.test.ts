import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// In-memory users keyed by id; loginToken is the single-use access link.
type FakeUser = { id: string; active: boolean; role: string; loginToken: string | null };
const db = vi.hoisted(() => ({
  users: new Map<string, { id: string; active: boolean; role: string; loginToken: string | null }>(),
  sessions: [] as { userId: string; token: string }[],
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { loginToken: string } }) =>
        [...db.users.values()].find((u) => u.loginToken === where.loginToken) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; loginToken: string }; data: { loginToken: null } }) => {
        const u = db.users.get(where.id);
        if (!u || u.loginToken !== where.loginToken) return { count: 0 };
        u.loginToken = data.loginToken;
        return { count: 1 };
      }),
    },
    userSession: {
      create: vi.fn(async ({ data }: { data: { userId: string; token: string } }) => {
        db.sessions.push({ userId: data.userId, token: data.token });
        return data;
      }),
    },
  };
  return { prisma: { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({
  portalPath: (role: string) => (role === "client" ? "/client" : role === "worker" ? "/worker" : "/admin"),
}));
const cookieSet = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.7" })),
  cookies: vi.fn(async () => ({ set: cookieSet, get: vi.fn(), delete: vi.fn() })),
}));

import { loginWithToken } from "@/app/[locale]/login/actions";

function seed(user: FakeUser) {
  db.users.set(user.id, { ...user });
}

describe("loginWithToken — single-use access links", () => {
  beforeEach(() => {
    db.users.clear();
    db.sessions.length = 0;
    cookieSet.mockClear();
  });

  it("signs in once, then the same link is rejected", async () => {
    seed({ id: "w1", active: true, role: "worker", loginToken: "tok-1" });

    const first = await loginWithToken("tok-1");
    expect(first).toMatchObject({ ok: true, redirect: "/worker" });
    expect(db.sessions).toHaveLength(1);
    expect(db.users.get("w1")!.loginToken).toBeNull();
    expect(cookieSet).toHaveBeenCalledWith("app_session", db.sessions[0].token,
      expect.objectContaining({ httpOnly: true, maxAge: 60 * 60 * 24 * 365 * 10 }));

    const second = await loginWithToken("tok-1");
    expect(second).toEqual({ ok: false, error: "invalid" });
    expect(db.sessions).toHaveLength(1);
  });

  it("lets only one of two simultaneous clicks through", async () => {
    seed({ id: "c1", active: true, role: "client", loginToken: "tok-2" });
    const results = await Promise.all([loginWithToken("tok-2"), loginWithToken("tok-2")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(db.sessions).toHaveLength(1);
  });

  it("rejects inactive accounts and roles that do not use access links", async () => {
    seed({ id: "w2", active: false, role: "worker", loginToken: "tok-3" });
    seed({ id: "a1", active: true, role: "super_admin", loginToken: "tok-4" });

    expect(await loginWithToken("tok-3")).toEqual({ ok: false, error: "invalid" });
    expect(await loginWithToken("tok-4")).toEqual({ ok: false, error: "invalid" });
    expect(await loginWithToken("")).toEqual({ ok: false, error: "invalid" });
    expect(db.sessions).toHaveLength(0);
    // A rejected attempt must not burn the link.
    expect(db.users.get("a1")!.loginToken).toBe("tok-4");
  });
});
