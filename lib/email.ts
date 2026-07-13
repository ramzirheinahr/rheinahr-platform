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

// Send an email to the specified users by their userIds.
export async function sendEmailToUsers(
  userIds: string[],
  payload: EmailPayload,
): Promise<void> {
  const mailer = getTransporter();
  if (!mailer || userIds.length === 0) return;

  const uniqueIds = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { email: true },
  });

  if (users.length === 0) return;

  const emails = users.map((u) => u.email).filter(Boolean);
  if (emails.length === 0) return;

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
  <strong>RheinAhr Dienstleistungen GmbH</strong> | Am Fronhof 4, 53177 Bonn<br>
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

  // To prevent exposing all emails to each other, we can send individually or use BCC.
  // Using BCC is more efficient for multiple recipients of the exact same message.
  try {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_FROM, // Send to self
      bcc: emails,    // BCC the actual recipients
      subject: payload.subject,
      text: textBody,
      html: finalHtml,
      attachments: payload.attachments,
    });
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
