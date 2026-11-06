import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAttempts, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ portalPath: () => "/worker" }));
const findUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: findUser } } }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => requestHeaders.current),
  cookies: vi.fn(async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() })),
}));

import { loginUser } from "@/app/[locale]/login/actions";

describe("rate-limit windows", () => {
  it("limits after `limit` attempts and resets when the window ends", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) recordAttempt("k1", 60_000, t0);
    expect(isRateLimited("k1", 3, t0 + 1)).toBe(true);
    expect(isRateLimited("k1", 4, t0 + 1)).toBe(false);
    expect(isRateLimited("k1", 3, t0 + 60_000)).toBe(false);
  });

  it("clearAttempts resets a key", () => {
    recordAttempt("k2", 60_000);
    clearAttempts("k2");
    expect(isRateLimited("k2", 1)).toBe(false);
  });
});

describe("clientIp", () => {
  it("prefers Cloudflare's CF-Connecting-IP over spoofable X-Forwarded-For", () => {
    const h = new Headers({ "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "6.6.6.6, 198.51.100.1" });
    expect(clientIp(h)).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe("loginUser brute-force protection", () => {
  beforeEach(() => {
    findUser.mockReset().mockResolvedValue(null);
  });

  it("blocks an email after 5 failures, even from rotating IPs", async () => {
    for (let i = 0; i < 5; i++) {
      requestHeaders.current = new Headers({ "cf-connecting-ip": `192.0.2.${i}` });
      expect(await loginUser("victim@example.com", "guess")).toEqual({ ok: false, error: "invalidCredentials" });
    }
    requestHeaders.current = new Headers({ "cf-connecting-ip": "192.0.2.99" });
    expect(await loginUser("Victim@Example.com ", "guess")).toEqual({ ok: false, error: "tooManyAttempts" });
    // Blocked attempts never reach the database (no password checking at all).
    expect(findUser).toHaveBeenCalledTimes(5);
  });

  it("blocks an IP spraying many accounts after 30 failures", async () => {
    requestHeaders.current = new Headers({ "cf-connecting-ip": "198.51.100.77" });
    for (let i = 0; i < 30; i++) await loginUser(`user${i}@example.com`, "guess");
    expect(await loginUser("someone-else@example.com", "guess")).toEqual({ ok: false, error: "tooManyAttempts" });
  });
});
