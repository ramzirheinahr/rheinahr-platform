import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getCompanyConfig } from "@/lib/config/company";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || "info@rheinahr-gmbh.de";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
      console.warn("SMTP credentials are not fully configured in environment variables.");
      return null;
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for other ports
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
      connectionTimeout: 15000, // 15 seconds timeout
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

export type EmailPayload = {
  subject: string;
  body: string;
  html?: string;
  url?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export function extractAttachmentMetadata(attachments?: any[]): { filename: string; contentType?: string; size?: number }[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((a) => ({
    filename: a.filename || "unnamed_attachment",
    contentType: a.contentType,
    size: a.content ? (Buffer.isBuffer(a.content) ? a.content.length : typeof a.content === "string" ? Buffer.byteLength(a.content) : undefined) : undefined,
  }));
}

export async function logOutgoingEmail({
  to,
  recipientName,
  userId,
  subject,
  body,
  html,
  status,
  error,
  attachments,
}: {
  to: string;
  recipientName?: string | null;
  userId?: string | null;
  subject: string;
  body: string;
  html?: string | null;
  status: "sent" | "failed" | "skipped_preference";
  error?: string | null;
  attachments?: { filename: string; contentType?: string; size?: number }[];
}) {
  try {
    await prisma.outgoingEmail.create({
      data: {
        to: to.trim().toLowerCase(),
        recipientName: recipientName || null,
        userId: userId || null,
        subject,
        body,
        html: html || null,
        status,
        error: error || null,
        attachments: attachments && attachments.length > 0 ? (attachments as any) : undefined,
      },
    });
  } catch (logErr) {
    console.error("Failed to log outgoing email:", logErr);
  }
}

export async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: any[];
}) {
  const normalizedTo = payload.to.trim().toLowerCase();
  const textBody = payload.text || payload.html.replace(/<[^>]+>/g, "");
  const attachmentMeta = extractAttachmentMetadata(payload.attachments);

  // Check if recipient is a known user to get userId & recipientName & preferences
  let user: { id: string; fullName: string | null; receiveEmails: boolean; active: boolean } | null = null;
  try {
    user = await prisma.user.findUnique({
      where: { email: normalizedTo },
      select: { id: true, fullName: true, receiveEmails: true, active: true },
    });
  } catch {}

  if (user && !user.active) {
    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user.fullName,
      userId: user.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "skipped_preference",
      error: "Benutzerkonto ist inaktiv (active: false)",
      attachments: attachmentMeta,
    });
    return;
  }

  const mailer = getTransporter();
  if (!mailer) {
    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user?.fullName,
      userId: user?.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "failed",
      error: "SMTP credentials are not fully configured in environment variables.",
      attachments: attachmentMeta,
    });
    return;
  }

  try {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: normalizedTo,
      subject: payload.subject,
      text: textBody,
      html: payload.html,
      attachments: payload.attachments,
    });

    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user?.fullName,
      userId: user?.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "sent",
      attachments: attachmentMeta,
    });
  } catch (err: any) {
    console.error(`Failed to send email to ${normalizedTo}:`, err);
    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user?.fullName,
      userId: user?.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "failed",
      error: err?.message || String(err),
      attachments: attachmentMeta,
    });
  }
}

// Send an email to the specified users by their userIds or direct email addresses.
export async function sendEmailToRecipients(
  recipients: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<void> {
  if (recipients.length === 0) return;

  const directEmails = recipients.filter((r) => r.includes("@"));
  const userIds = recipients.filter((r) => !r.includes("@"));

  type ResolvedRecipient = {
    email: string;
    userId?: string;
    name?: string | null;
  };

  const toSend: ResolvedRecipient[] = [];
  const attachmentMeta = extractAttachmentMetadata(payload.attachments);

  let textBody = payload.body;
  if (payload.url) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://platform.rheinahr-gmbh.de";
    const fullUrl = payload.url.startsWith("http") ? payload.url : `${appUrl}${payload.url}`;
    textBody += `\n\nLink: ${fullUrl}`;
  }
  const contentHtml = payload.html || textBody.replace(/\n/g, "<br>");
  const finalHtml = `
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  ${contentHtml}
  ${await getEmailFooterHtml()}
</div>
  `;

  if (userIds.length > 0) {
    const uniqueIds = [...new Set(userIds)];
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, email: true, fullName: true, active: true, receiveEmails: true },
    });

    for (const u of users) {
      if (!u.email) continue;
      const normalizedEmail = u.email.trim().toLowerCase();

      if (!u.active) {
        await logOutgoingEmail({
          to: normalizedEmail,
          recipientName: u.fullName,
          userId: u.id,
          subject: payload.subject,
          body: textBody,
          html: finalHtml,
          status: "skipped_preference",
          error: "Benutzerkonto ist inaktiv (active: false)",
          attachments: attachmentMeta,
        });
        continue;
      }

      if (!options?.force && !u.receiveEmails) {
        await logOutgoingEmail({
          to: normalizedEmail,
          recipientName: u.fullName,
          userId: u.id,
          subject: payload.subject,
          body: textBody,
          html: finalHtml,
          status: "skipped_preference",
          error: "Benutzer hat den E-Mail-Empfang deaktiviert (receiveEmails: false)",
          attachments: attachmentMeta,
        });
        continue;
      }

      toSend.push({ email: normalizedEmail, userId: u.id, name: u.fullName });
    }
  }

  // Also handle direct email addresses
  for (const raw of directEmails) {
    const normalizedEmail = raw.trim().toLowerCase();
    if (!toSend.some((t) => t.email === normalizedEmail)) {
      // Look up if this email belongs to a user
      const u = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, fullName: true, active: true, receiveEmails: true },
      }).catch(() => null);

      if (u && !u.active) {
        await logOutgoingEmail({
          to: normalizedEmail,
          recipientName: u.fullName,
          userId: u.id,
          subject: payload.subject,
          body: textBody,
          html: finalHtml,
          status: "skipped_preference",
          error: "Benutzerkonto ist inaktiv (active: false)",
          attachments: attachmentMeta,
        });
        continue;
      }

      if (u && !options?.force && !u.receiveEmails) {
        await logOutgoingEmail({
          to: normalizedEmail,
          recipientName: u.fullName,
          userId: u.id,
          subject: payload.subject,
          body: textBody,
          html: finalHtml,
          status: "skipped_preference",
          error: "Benutzer hat den E-Mail-Empfang deaktiviert (receiveEmails: false)",
          attachments: attachmentMeta,
        });
        continue;
      }

      toSend.push({ email: normalizedEmail, userId: u?.id, name: u?.fullName });
    }
  }

  if (toSend.length === 0) return;

  const mailer = getTransporter();
  if (!mailer) {
    for (const r of toSend) {
      await logOutgoingEmail({
        to: r.email,
        recipientName: r.name,
        userId: r.userId,
        subject: payload.subject,
        body: textBody,
        html: finalHtml,
        status: "failed",
        error: "SMTP credentials are not fully configured in environment variables.",
        attachments: attachmentMeta,
      });
    }
    return;
  }

  try {
    await Promise.allSettled(
      toSend.map(async (r) => {
        try {
          await mailer.sendMail({
            from: EMAIL_FROM,
            to: r.email,
            subject: payload.subject,
            text: textBody,
            html: finalHtml,
            attachments: payload.attachments,
          });

          await logOutgoingEmail({
            to: r.email,
            recipientName: r.name,
            userId: r.userId,
            subject: payload.subject,
            body: textBody,
            html: finalHtml,
            status: "sent",
            attachments: attachmentMeta,
          });
        } catch (err: any) {
          console.error(`Failed to send email to ${r.email}:`, err);
          await logOutgoingEmail({
            to: r.email,
            recipientName: r.name,
            userId: r.userId,
            subject: payload.subject,
            body: textBody,
            html: finalHtml,
            status: "failed",
            error: err?.message || String(err),
            attachments: attachmentMeta,
          });
        }
      })
    );
  } catch (error) {
    console.error("Error sending emails:", error);
  }
}

// Send an email to the specified users by their userIds.
export async function sendEmailToUsers(
  userIds: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<void> {
  return sendEmailToRecipients(userIds, payload, options);
}

export async function getEmailFooterHtml(): Promise<string> {
  const companyConfig = await getCompanyConfig();
  return `
<br><br>
<hr style="border: 0; border-top: 1px solid #eee; margin-bottom: 20px;" />
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #555; line-height: 1.6;">
  Mit freundlichen Grüßen<br><br>
  <strong>${companyConfig.ceo}</strong><br>
  Geschäftsführung<br><br>
  <div style="margin-top: 15px; margin-bottom: 15px;">
    <img src="${companyConfig.websiteUrl}${companyConfig.logoUrl}" alt="${companyConfig.name}" style="max-height: 50px; width: auto;" />
  </div>
  <strong>${companyConfig.name}</strong> | ${companyConfig.street}, ${companyConfig.city}<br>
  Telefon: ${companyConfig.phone} | Handy: ${companyConfig.mobile} | Telefax: ${companyConfig.fax}<br>
  Email: <a href="mailto:${companyConfig.email}" style="color: #0056b3; text-decoration: none;">${companyConfig.email}</a> | Web: <a href="${companyConfig.websiteUrl}" style="color: #0056b3; text-decoration: none;">${companyConfig.website}</a><br>
  Portal: <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/de/admin" style="color: #0056b3; text-decoration: none;">Zum Portal</a>
</div>
  `;
}

