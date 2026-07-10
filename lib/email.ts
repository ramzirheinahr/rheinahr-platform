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

  // Append URL if provided
  let textBody = payload.body;
  if (payload.url) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://platform.rheinahr-gmbh.de";
    const fullUrl = payload.url.startsWith("http") ? payload.url : `${appUrl}${payload.url}`;
    textBody += `\n\nLink: ${fullUrl}`;
  }

  // To prevent exposing all emails to each other, we can send individually or use BCC.
  // Using BCC is more efficient for multiple recipients of the exact same message.
  try {
    await mailer.sendMail({
      from: EMAIL_FROM,
      to: EMAIL_FROM, // Send to self
      bcc: emails,    // BCC the actual recipients
      subject: payload.subject,
      text: textBody,
      html: payload.html || textBody.replace(/\n/g, "<br>"),
    });
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
