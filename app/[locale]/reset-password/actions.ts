"use server";

import { executePasswordReset, verifyPasswordResetToken } from "@/lib/password-reset";

export async function checkTokenValidAction(token: string) {
  const verified = await verifyPasswordResetToken(token);
  return !!verified;
}

export async function resetPasswordAction(token: string, formData: FormData) {
  const password = formData.get("password")?.toString() || "";
  const confirmPassword = formData.get("confirmPassword")?.toString() || "";

  if (password !== confirmPassword) {
    return { ok: false, error: "passwordMismatch" };
  }

  return await executePasswordReset(token, password);
}
