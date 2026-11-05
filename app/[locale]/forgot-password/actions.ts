"use server";

import { createPasswordResetToken } from "@/lib/password-reset";

export async function requestPasswordResetAction(
  locale: string,
  formData: FormData
) {
  const email = formData.get("email")?.toString() || "";

  // The reset link's origin comes from NEXT_PUBLIC_APP_URL only — never from the
  // request's Host / X-Forwarded-Host headers, which the sender controls and
  // could point at an attacker's site to capture the reset token.
  return await createPasswordResetToken(email, locale);
}
