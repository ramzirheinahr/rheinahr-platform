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

  const finalHtml = `
<div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
  ${contentHtml}
  ${await getEmailFooterHtml()}
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

async function getEmailFooterHtml(): Promise<string> {
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

