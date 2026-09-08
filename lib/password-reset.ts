import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendEmail, getEmailFooterHtml } from "@/lib/email";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PasswordResetState = {
  ok: boolean;
  error?: string;
};

/**
 * Creates a password reset token and sends an email to the user.
 * Implements security best practices:
 * - Always returns { ok: true } on the outside to prevent email enumeration.
 * - Generates a 32-byte cryptographically secure random token.
 * - Sets a 1-hour expiration.
 * - Logs audit event.
 */
export async function createPasswordResetToken(
  emailInput: string,
  locale: string = "de",
  originUrl?: string
): Promise<PasswordResetState> {
  const email = emailInput.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: true };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, active: true },
  });

  // If user does not exist or is inactive, don't disclose
  if (!user || !user.active) {
    return { ok: true };
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: token,
      passwordResetExpires: expires,
    },
  });

  const baseUrl = originUrl || process.env.NEXT_PUBLIC_APP_URL || "https://app.rheinahr-gmbh.de";
  const resetUrl = `${baseUrl}/${locale}/reset-password?token=${token}`;

  const greeting = user.fullName ? `Hallo ${user.fullName},` : "Hallo,";
  
  let subject = "Passwort zurücksetzen – RheinAhr Dienstleistungen";
  let bodyContent = `
    <p>${greeting}</p>
    <p>Sie haben das Zurücksetzen Ihres Passworts für die RheinAhr-Plattform angefordert.</p>
    <p>Klicken Sie auf den folgenden Button, um ein neues Passwort festzulegen:</p>
    <p style="margin: 24px 0;">
      <a href="${resetUrl}" style="background-color: #1e40af; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Neues Passwort festlegen
      </a>
    </p>
    <p style="color: #666; font-size: 13px;">Dieser Link ist aus Sicherheitsgründen für <strong>1 Stunde</strong> gültig.</p>
    <p style="color: #666; font-size: 13px;">Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren. Ihr Passwort bleibt unverändert.</p>
  `;

  if (locale === "en") {
    subject = "Reset password – RheinAhr Dienstleistungen";
    bodyContent = `
      <p>Hello${user.fullName ? ` ${user.fullName}` : ""},</p>
      <p>You requested to reset your password for the RheinAhr platform.</p>
      <p>Click the button below to set a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #1e40af; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Set new password
        </a>
      </p>
      <p style="color: #666; font-size: 13px;">For security reasons, this link is valid for <strong>1 hour</strong>.</p>
      <p style="color: #666; font-size: 13px;">If you did not request this, you can safely ignore this email.</p>
    `;
  } else if (locale === "ar") {
    subject = "إعادة تعيين كلمة المرور – RheinAhr Dienstleistungen";
    bodyContent = `
      <p style="direction: rtl; text-align: right;">مرحباً${user.fullName ? ` ${user.fullName}` : ""}،</p>
      <p style="direction: rtl; text-align: right;">لقد طلبت إعادة تعيين كلمة المرور الخاصة بحسابك في منصة RheinAhr.</p>
      <p style="direction: rtl; text-align: right;">انقر على الزر أدناه لتعيين كلمة مرور جديدة:</p>
      <p style="margin: 24px 0; direction: rtl; text-align: right;">
        <a href="${resetUrl}" style="background-color: #1e40af; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          تعيين كلمة مرور جديدة
        </a>
      </p>
      <p style="color: #666; font-size: 13px; direction: rtl; text-align: right;">هذا الرابط صالح لمدة <strong>ساعة واحدة</strong> فقط لدواعي الأمان.</p>
      <p style="color: #666; font-size: 13px; direction: rtl; text-align: right;">إذا لم تقم بتقديم هذا الطلب، يمكنك تجاهل هذه الرسالة بأمان.</p>
    `;
  }

  const footerHtml = await getEmailFooterHtml();

  await sendEmail({
    to: user.email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${bodyContent}
        ${footerHtml}
      </div>
    `,
  });

  await audit({
    userId: user.id,
    action: "auth.password_reset_requested",
    entity: "User",
    entityId: user.id,
  });

  return { ok: true };
}

/**
 * Verifies if a reset token is valid and not expired.
 */
export async function verifyPasswordResetToken(token: string) {
  if (!token || typeof token !== "string" || token.length < 32) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: token },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordResetExpires: true,
      active: true,
    },
  });

  if (!user || !user.active || !user.passwordResetExpires) {
    return null;
  }

  if (user.passwordResetExpires < new Date()) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  };
}

/**
 * Resets user's password using the verified token.
 */
export async function executePasswordReset(
  token: string,
  newPassword: string
): Promise<PasswordResetState> {
  const verified = await verifyPasswordResetToken(token);
  if (!verified) {
    return { ok: false, error: "invalidOrExpiredToken" };
  }

  if (!newPassword || newPassword.length < 12) {
    return { ok: false, error: "passwordMinLength" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Update password in Prisma and clear reset token
  await prisma.user.update({
    where: { id: verified.userId },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  // Also terminate all existing sessions for security
  await prisma.userSession.deleteMany({
    where: { userId: verified.userId },
  });

  // Mirror update to Supabase Auth if user exists there
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.auth.admin.updateUserById(verified.userId, { password: newPassword });
  } catch (err) {
    console.warn("Supabase auth password update skipped or failed:", err);
  }

  await audit({
    userId: verified.userId,
    action: "auth.password_reset_completed",
    entity: "User",
    entityId: verified.userId,
  });

  return { ok: true };
}
