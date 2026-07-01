import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { portalPath } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from "@/lib/access";

// Passwordless access-link login: verify the 6-digit PIN for the account behind
// <token>, and on success mint a real Supabase session (server-side, no email
// sent) whose cookies persist the login on this device. Admins keep email login.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(10).max(256),
  pin: z.string().regex(/^\d{6}$/),
});

// Uniform response so a wrong PIN can't be told apart from an unknown token.
function invalid() {
  return NextResponse.json({ ok: false, error: "invalid" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return invalid();
  const { token, pin } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { loginToken: token },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
      loginPinHash: true,
      loginPinAttempts: true,
      loginPinLockUntil: true,
    },
  });
  if (!user || !user.active || !user.loginPinHash) return invalid();

  // Temporary lockout after too many wrong PINs (brute-force protection).
  if (user.loginPinLockUntil && user.loginPinLockUntil > new Date()) {
    return NextResponse.json({ ok: false, error: "locked" }, { status: 429 });
  }

  const match = await bcrypt.compare(pin, user.loginPinHash);
  if (!match) {
    const attempts = user.loginPinAttempts + 1;
    const locking = attempts >= PIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: locking
        ? {
            loginPinAttempts: 0,
            loginPinLockUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000),
          }
        : { loginPinAttempts: attempts },
    });
    await audit({
      userId: user.id,
      action: "access.pin.fail",
      entity: "User",
      entityId: user.id,
      ipAddress: ip,
      metadata: { locked: locking },
    });
    return locking
      ? NextResponse.json({ ok: false, error: "locked" }, { status: 429 })
      : invalid();
  }

  // Correct PIN — clear counters and establish a Supabase session on this device.
  const admin = createSupabaseAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 500 });
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: (link.properties.verification_type ?? "magiclink") as "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 500 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { loginPinAttempts: 0, loginPinLockUntil: null },
  });
  await audit({
    userId: user.id,
    action: "access.pin.success",
    entity: "User",
    entityId: user.id,
    ipAddress: ip,
  });

  return NextResponse.json({ ok: true, redirect: portalPath(user.role) });
}
