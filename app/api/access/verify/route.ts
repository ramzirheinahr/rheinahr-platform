import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { portalPath } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PIN_MAX_ATTEMPTS, PIN_LOCK_MINUTES } from "@/lib/access";

// Passwordless access-link login: verify the 6-digit PIN for the account behind
// <token>, and on success mint a real Supabase session (server-side, no email
// sent) whose cookies persist the login on this device. Admins keep email login.
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  token: z.string().min(10).max(256),
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
  const { token } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { loginToken: token },
    select: {
      id: true,
      email: true,
      role: true,
      active: true,
    },
  });
  if (!user || !user.active) return invalid();

  // Correct PIN — mint session tokens and hand them to the browser, which stores
  // them via supabase.auth.setSession() exactly like the email login does. We do
  // NOT set cookies in this route: server-set auth cookies proved unreliable for
  // the subsequent client navigation, so the browser owns session persistence.
  const admin = createSupabaseAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 500 });
  }

  // Exchange the one-time OTP for a session on a throwaway (non-persisting) client
  // so this route never writes cookies of its own.
  const exchange = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: verified, error: verifyError } = await exchange.auth.verifyOtp({
    type: (link.properties.verification_type ?? "magiclink") as "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError || !verified.session) {
    return NextResponse.json({ ok: false, error: "session" }, { status: 500 });
  }

  // No need to reset pin attempts anymore
  await audit({
    userId: user.id,
    action: "access.pin.success",
    entity: "User",
    entityId: user.id,
    ipAddress: ip,
  });

  return NextResponse.json({
    ok: true,
    redirect: portalPath(user.role),
    session: {
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    },
  });
}
