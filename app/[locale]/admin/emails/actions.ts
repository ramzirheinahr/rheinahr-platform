"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { sendEmail, getEmailFooterHtml } from "@/lib/email";
import { z } from "zod";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
}

export type ActionState = { ok: boolean; error?: string };

export async function resendOutgoingEmail(emailId: string): Promise<ActionState> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!z.string().uuid().safeParse(emailId).success) {
    return { ok: false, error: "invalidId" };
  }

  const record = await prisma.outgoingEmail.findUnique({
    where: { id: emailId },
  });

  if (!record) {
    return { ok: false, error: "notFound" };
  }

  try {
    await sendEmail({
      to: record.to,
      subject: record.subject,
      html: record.html || `<p>${record.body.replace(/\n/g, "<br>")}</p>`,
      text: record.body,
    });

    revalidatePath("/admin/emails");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "sendFailed" };
  }
}

export async function sendTestEmail(targetEmail: string): Promise<ActionState> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const emailSchema = z.string().email();
  if (!emailSchema.safeParse(targetEmail).success) {
    return { ok: false, error: "invalidEmail" };
  }

  try {
    const footer = await getEmailFooterHtml();
    const testHtml = `
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  <h2>Test-E-Mail von der RheinAhr Plattform</h2>
  <p>Guten Tag,</p>
  <p>dies ist eine automatische Test-E-Mail zur Überprüfung der SMTP-Konfiguration und des E-Mail-Dienstes der RheinAhr Plattform.</p>
  <p>Wenn Sie diese E-Mail erhalten haben, funktioniert der E-Mail-Versand einwandfrei.</p>
  <p style="color: #666; font-size: 13px;">Zeitstempel: ${new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</p>
  ${footer}
</div>
    `;

    await sendEmail({
      to: targetEmail,
      subject: "Test-E-Mail – RheinAhr Plattform",
      html: testHtml,
      text: "Dies ist eine automatische Test-E-Mail zur Überprüfung des E-Mail-Dienstes der RheinAhr Plattform.",
    });

    revalidatePath("/admin/emails");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "sendFailed" };
  }
}

export async function deleteOutgoingEmail(emailId: string): Promise<ActionState> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!z.string().uuid().safeParse(emailId).success) {
    return { ok: false, error: "invalidId" };
  }

  try {
    await prisma.outgoingEmail.delete({
      where: { id: emailId },
    });
    revalidatePath("/admin/emails");
    return { ok: true };
  } catch {
    return { ok: false, error: "deleteFailed" };
  }
}
