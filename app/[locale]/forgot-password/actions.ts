"use server";

import { headers } from "next/headers";
import { createPasswordResetToken } from "@/lib/password-reset";
import { clientIp } from "@/lib/client-ip";
import { LIMITS, isRateLimited, recordAttempt } from "@/lib/rate-limit";

export async function requestPasswordResetAction(
  locale: string,
  formData: FormData
) {
  const email = formData.get("email")?.toString() || "";

  // Throttle reset mails per address and per IP. Over the limit we still answer
  // { ok: true } (same as for unknown emails) so nothing is revealed.
  const ip = clientIp(await headers()) || "unknown";
  const emailKey = `reset:email:${email.trim().toLowerCase()}`;
  const ipKey = `reset:ip:${ip}`;
  if (
    isRateLimited(emailKey, LIMITS.resetPerEmail.limit) ||
    isRateLimited(ipKey, LIMITS.resetPerIp.limit)
  ) {
    return { ok: true };
  }
  recordAttempt(emailKey, LIMITS.resetPerEmail.windowMs);
  recordAttempt(ipKey, LIMITS.resetPerIp.windowMs);

  // The reset link's origin comes from NEXT_PUBLIC_APP_URL only — never from the
  // request's Host / X-Forwarded-Host headers, which the sender controls and
  // could point at an attacker's site to capture the reset token.
  return await createPasswordResetToken(email, locale);
}
