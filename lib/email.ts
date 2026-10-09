import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCompanyConfig } from "@/lib/config/company";
import { decrypt } from "@/lib/crypto";

export type EmailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
  source: "database" | "environment";
};

export async function getEmailConfig(): Promise<EmailConfig | null> {
  try {
    const settings = await prisma.systemSetting.findMany({
      where: { key: { startsWith: "email." } },
    });

    const map = settings.reduce((acc, s) => {
      acc[s.key] = s.value;
      return acc;
    }, {} as Record<string, string>);

    const dbHost = map["email.smtp_host"]?.trim();
    const dbUser = map["email.smtp_user"]?.trim();
    const dbPortStr = map["email.smtp_port"]?.trim();
    const dbPassEncrypted = map["email.smtp_password"]?.trim();
    const dbFrom = map["email.from"]?.trim();

    if (dbHost && dbUser && dbPassEncrypted) {
      const port = dbPortStr ? parseInt(dbPortStr) : 465;
      const pass = decrypt(dbPassEncrypted);
      const from = dbFrom || dbUser;
      return {
        host: dbHost,
        port,
        user: dbUser,
        pass,
        from,
        secure: port === 465,
        source: "database",
      };
    }
  } catch (err) {
    console.error("Failed to load email config from system settings:", err);
  }

  // Fallback to environment variables
  const envHost = process.env.SMTP_HOST?.trim();
  const envPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465;
  const envUser = process.env.SMTP_USER?.trim();
  const envPass = process.env.SMTP_PASSWORD?.trim();
  const envFrom = process.env.EMAIL_FROM?.trim() || "info@rheinahr-gmbh.de";

  if (envHost && envUser && envPass) {
    return {
      host: envHost,
      port: envPort,
      user: envUser,
      pass: envPass,
      from: envFrom,
      secure: envPort === 465,
      source: "environment",
    };
  }

  return null;
}

export async function getTransporter(): Promise<nodemailer.Transporter | null> {
  const config = await getEmailConfig();
  if (!config) {
    console.warn("SMTP credentials are not configured in system settings or environment variables.");
    return null;
  }
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    connectionTimeout: 15000, // 15 seconds timeout
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

export type EmailPayload = {
  subject: string;
  body: string;
  html?: string;
  url?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export type EmailAttachmentInput = {
  filename?: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
};

export function extractAttachmentMetadata(
  attachments?: EmailAttachmentInput[]
): { filename: string; contentType?: string; size?: number }[] | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined;
  return attachments.map((a) => {
    const rawContent = a.content;
    const size = rawContent
      ? Buffer.isBuffer(rawContent)
        ? rawContent.length
        : typeof rawContent === "string"
        ? Buffer.byteLength(rawContent)
        : undefined
      : undefined;
    return {
      filename: a.filename || "unnamed_attachment",
      contentType: a.contentType,
      size,
    };
  });
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
        attachments: attachments && attachments.length > 0 ? (attachments as Prisma.InputJsonValue) : undefined,
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
  attachments?: EmailAttachmentInput[];
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

  const emailConfig = await getEmailConfig();
  const mailer = await getTransporter();
  if (!mailer || !emailConfig) {
    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user?.fullName,
      userId: user?.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "failed",
      error: "SMTP credentials are not configured in system settings or environment variables.",
      attachments: attachmentMeta,
    });
    return;
  }

  try {
    await mailer.sendMail({
      from: emailConfig.from,
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
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to send email to ${normalizedTo}:`, err);
    await logOutgoingEmail({
      to: normalizedTo,
      recipientName: user?.fullName,
      userId: user?.id,
      subject: payload.subject,
      body: textBody,
      html: payload.html,
      status: "failed",
      error: errorMsg,
      attachments: attachmentMeta,
    });
  }
}

export type EmailDispatchFailure = {
  recipient: string;
  error: string;
};

export type EmailDispatchSkipped = {
  recipient: string;
  reason: string;
};

export type EmailDispatchUnresolved = {
  recipient: string;
  reason: string;
};

export interface EmailDispatchReport {
  smtpConfigured: boolean;
  rawInputCount: number;
  distinctTargetCount: number;
  totalRequested: number;
  eligibleCount: number;
  acceptedCount: number;
  failedCount: number;
  skippedCount: number;
  unresolvedCount: number;
  eligibleRecipients: string[];
  acceptedRecipients: string[];
  failedRecipients: EmailDispatchFailure[];
  skippedRecipients: EmailDispatchSkipped[];
  unresolvedRecipients: EmailDispatchUnresolved[];
}

// Send an email to the specified users by their userIds or direct email addresses and return a detailed report.
export async function sendEmailToRecipientsWithReport(
  recipients: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<EmailDispatchReport> {
  const rawInputCount = Array.isArray(recipients) ? recipients.length : 0;

  if (!recipients || recipients.length === 0) {
    return {
      smtpConfigured: true,
      rawInputCount: 0,
      distinctTargetCount: 0,
      totalRequested: 0,
      eligibleCount: 0,
      acceptedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      unresolvedCount: 0,
      eligibleRecipients: [],
      acceptedRecipients: [],
      failedRecipients: [],
      skippedRecipients: [],
      unresolvedRecipients: [],
    };
  }

  const unresolvedRecipients: EmailDispatchUnresolved[] = [];
  const skippedRecipients: EmailDispatchSkipped[] = [];

  const rawDirectEmails: string[] = [];
  const rawUserIds: string[] = [];

  for (const raw of recipients) {
    if (!raw || typeof raw !== "string" || !raw.trim()) {
      unresolvedRecipients.push({ recipient: String(raw ?? ""), reason: "Ungültige oder leere Empfängerangabe" });
    } else if (raw.includes("@")) {
      rawDirectEmails.push(raw.trim());
    } else {
      rawUserIds.push(raw.trim());
    }
  }

  type CandidateDestination = {
    email: string;
    userId?: string;
    name?: string | null;
    active: boolean;
    receiveEmails: boolean;
  };
  const candidatesByEmail = new Map<string, CandidateDestination>();

  const uniqueUserIds = [...new Set(rawUserIds)];
  if (uniqueUserIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true, email: true, fullName: true, active: true, receiveEmails: true },
    });
    const foundUserMap = new Map(users.map((u) => [u.id, u]));

    for (const id of uniqueUserIds) {
      const u = foundUserMap.get(id);
      if (!u) {
        unresolvedRecipients.push({ recipient: id, reason: `Benutzerkonto nicht gefunden (ID: ${id})` });
        continue;
      }
      if (!u.email || !u.email.trim()) {
        unresolvedRecipients.push({ recipient: id, reason: "Benutzer hat keine E-Mail-Adresse" });
        continue;
      }
      const normalizedEmail = u.email.trim().toLowerCase();
      if (!candidatesByEmail.has(normalizedEmail)) {
        candidatesByEmail.set(normalizedEmail, {
          email: normalizedEmail,
          userId: u.id,
          name: u.fullName,
          active: u.active,
          receiveEmails: u.receiveEmails,
        });
      }
    }
  }

  const uniqueDirectEmails = [...new Set(rawDirectEmails.map((e) => e.toLowerCase()))];
  for (const normalizedEmail of uniqueDirectEmails) {
    if (!candidatesByEmail.has(normalizedEmail)) {
      const u = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, fullName: true, active: true, receiveEmails: true },
      }).catch(() => null);

      candidatesByEmail.set(normalizedEmail, {
        email: normalizedEmail,
        userId: u?.id,
        name: u?.fullName,
        active: u ? u.active : true,
        receiveEmails: u ? u.receiveEmails : true,
      });
    }
  }

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

  type ResolvedRecipient = {
    email: string;
    userId?: string;
    name?: string | null;
  };
  const toSend: ResolvedRecipient[] = [];

  for (const candidate of candidatesByEmail.values()) {
    if (!candidate.active) {
      await logOutgoingEmail({
        to: candidate.email,
        recipientName: candidate.name,
        userId: candidate.userId,
        subject: payload.subject,
        body: textBody,
        html: finalHtml,
        status: "skipped_preference",
        error: "Benutzerkonto ist inaktiv (active: false)",
        attachments: attachmentMeta,
      });
      skippedRecipients.push({ recipient: candidate.email, reason: "Benutzerkonto ist inaktiv (active: false)" });
      continue;
    }

    if (!options?.force && !candidate.receiveEmails) {
      await logOutgoingEmail({
        to: candidate.email,
        recipientName: candidate.name,
        userId: candidate.userId,
        subject: payload.subject,
        body: textBody,
        html: finalHtml,
        status: "skipped_preference",
        error: "Benutzer hat den E-Mail-Empfang deaktiviert (receiveEmails: false)",
        attachments: attachmentMeta,
      });
      skippedRecipients.push({ recipient: candidate.email, reason: "Benutzer hat den E-Mail-Empfang deaktiviert (receiveEmails: false)" });
      continue;
    }

    toSend.push({ email: candidate.email, userId: candidate.userId, name: candidate.name });
  }

  const distinctTargetCount = toSend.length + skippedRecipients.length + unresolvedRecipients.length;

  if (toSend.length === 0) {
    return {
      smtpConfigured: true,
      rawInputCount,
      distinctTargetCount,
      totalRequested: distinctTargetCount,
      eligibleCount: 0,
      acceptedCount: 0,
      failedCount: 0,
      skippedCount: skippedRecipients.length,
      unresolvedCount: unresolvedRecipients.length,
      eligibleRecipients: [],
      acceptedRecipients: [],
      failedRecipients: [],
      skippedRecipients,
      unresolvedRecipients,
    };
  }

  const emailConfig = await getEmailConfig();
  const mailer = await getTransporter();
  if (!mailer || !emailConfig) {
    const failedRecipients: EmailDispatchFailure[] = [];
    for (const r of toSend) {
      const errMsg = "SMTP credentials are not configured in system settings or environment variables.";
      await logOutgoingEmail({
        to: r.email,
        recipientName: r.name,
        userId: r.userId,
        subject: payload.subject,
        body: textBody,
        html: finalHtml,
        status: "failed",
        error: errMsg,
        attachments: attachmentMeta,
      });
      failedRecipients.push({ recipient: r.email, error: errMsg });
    }
    return {
      smtpConfigured: false,
      rawInputCount,
      distinctTargetCount,
      totalRequested: distinctTargetCount,
      eligibleCount: toSend.length,
      acceptedCount: 0,
      failedCount: failedRecipients.length,
      skippedCount: skippedRecipients.length,
      unresolvedCount: unresolvedRecipients.length,
      eligibleRecipients: toSend.map((t) => t.email),
      acceptedRecipients: [],
      failedRecipients,
      skippedRecipients,
      unresolvedRecipients,
    };
  }

  const acceptedRecipients: string[] = [];
  const failedRecipients: EmailDispatchFailure[] = [];

  try {
    await Promise.allSettled(
      toSend.map(async (r) => {
        try {
          await mailer.sendMail({
            from: emailConfig.from,
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

          acceptedRecipients.push(r.email);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to send email to ${r.email}:`, err);
          await logOutgoingEmail({
            to: r.email,
            recipientName: r.name,
            userId: r.userId,
            subject: payload.subject,
            body: textBody,
            html: finalHtml,
            status: "failed",
            error: errMsg,
            attachments: attachmentMeta,
          });
          failedRecipients.push({ recipient: r.email, error: errMsg });
        }
      })
    );
  } catch (error) {
    console.error("Error sending emails:", error);
  }

  return {
    smtpConfigured: true,
    rawInputCount,
    distinctTargetCount,
    totalRequested: distinctTargetCount,
    eligibleCount: toSend.length,
    acceptedCount: acceptedRecipients.length,
    failedCount: failedRecipients.length,
    skippedCount: skippedRecipients.length,
    unresolvedCount: unresolvedRecipients.length,
    eligibleRecipients: toSend.map((t) => t.email),
    acceptedRecipients,
    failedRecipients,
    skippedRecipients,
    unresolvedRecipients,
  };
}

// Send an email to the specified users by their userIds or direct email addresses.
export async function sendEmailToRecipients(
  recipients: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<EmailDispatchReport> {
  return sendEmailToRecipientsWithReport(recipients, payload, options);
}

// Send an email to the specified users by their userIds.
export async function sendEmailToUsers(
  userIds: string[],
  payload: EmailPayload,
  options?: { force?: boolean }
): Promise<void> {
  await sendEmailToRecipients(userIds, payload, options);
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

