import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

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
      connectionTimeout: 3000, // 3 seconds timeout
      greetingTimeout: 3000,
      socketTimeout: 3000,
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

export async function sendEmail(payload: { to: string; subject: string; html: string; text?: string; attachments?: any[] }) {
  const mailer = getTransporter();
  if (!mailer) return;
  try {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: payload.to,
      subject: payload.subject,
      text: payload.text || payload.html.replace(/<[^>]+>/g, ""),
      html: payload.html,
      attachments: payload.attachments,
    });
  } catch (err) {
    console.error(`Failed to send email to ${payload.to}:`, err);
  }
}

// Send an email to the specified users by their userIds or direct email addresses.
export async function sendEmailToRecipients(
  recipients: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<void> {
  const mailer = getTransporter();
  if (!mailer || recipients.length === 0) return;

  const directEmails = recipients.filter((r) => r.includes("@"));
  const userIds = recipients.filter((r) => !r.includes("@"));

  const resolvedEmails = [...directEmails];

  if (userIds.length > 0) {
    const uniqueIds = [...new Set(userIds)];
    const users = await prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        active: true,
        ...(options?.force ? {} : { receiveEmails: true }),
      },
      select: { email: true },
    });
    users.forEach((u) => {
      if (u.email) resolvedEmails.push(u.email);
    });
  }

  const uniqueEmails = [...new Set(resolvedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (uniqueEmails.length === 0) return;

  let textBody = payload.body;
  const contentHtml = payload.html || textBody.replace(/\n/g, "<br>");

  const signatureHtml = `
<br><br>
<hr style="border: 0; border-top: 1px solid #eee; margin-bottom: 20px;" />
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #555; line-height: 1.6;">
  Mit freundlichen Grüßen<br><br>
  <strong>Mohammed Abuibaid</strong><br>
  Einsatzleiter<br><br>
  <div style="margin-top: 15px; margin-bottom: 15px;">
    <img src="https://platform.rheinahr-gmbh.de/logo.png" alt="RheinAhr Dienstleistungen GmbH" style="max-height: 50px; width: auto;" />
  </div>
  <strong>RheinAhr Dienstleistungen GmbH</strong> | Theaterplatz 1, 53177 Bonn<br>
  Telefon: +49 (228) 28683821 | Handy: +49 (1523) 3646562 | Telefax: +49 (228) 36039105<br>
  Email: <a href="mailto:info@rheinahr-gmbh.de" style="color: #0056b3; text-decoration: none;">info@rheinahr-gmbh.de</a> | Web: <a href="http://www.rheinahr-gmbh.de" style="color: #0056b3; text-decoration: none;">http://www.rheinahr-gmbh.de</a><br>
  Portal: <a href="https://platform.rheinahr-gmbh.de/de/admin" style="color: #0056b3; text-decoration: none;">platform.rheinahr-gmbh.de/de/admin</a>
</div>
  `;

  const finalHtml = `
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  ${contentHtml}
  ${signatureHtml}
</div>
  `;

  try {
    await Promise.allSettled(
      uniqueEmails.map(async (email) => {
        try {
          await mailer.sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: payload.subject,
            text: textBody,
            html: finalHtml,
            attachments: payload.attachments,
          });
        } catch (err) {
          console.error(`Failed to send email to ${email}:`, err);
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

