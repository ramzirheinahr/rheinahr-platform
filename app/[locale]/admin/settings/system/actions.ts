"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getSystemSettings() {
  const settings = await prisma.systemSetting.findMany();
  return settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value;
    return acc;
  }, {} as Record<string, string>);
}

export async function updateSystemSetting(key: string, value: string) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    throw new Error("Unauthorized");
  }
  
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  revalidatePath("/", "layout"); // revalidate everything to ensure landing page updates
}

export async function createSystemAssetUploadUrl(fileName: string) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    throw new Error("Unauthorized");
  }

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  
  const path = `landing/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { data, error } = await supabase.storage
    .from("system-assets")
    .createSignedUploadUrl(path);

  if (error || !data) {
    throw new Error("Failed to create upload URL: " + (error?.message || "Unknown error"));
  }

  return { path: data.path, token: data.token };
}

export async function saveEmailSettings(data: {
  host: string;
  port: string;
  user: string;
  password?: string;
  from?: string;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    throw new Error("Unauthorized");
  }

  const { encrypt } = await import("@/lib/crypto");

  const updates: [string, string][] = [
    ["email.smtp_host", data.host.trim()],
    ["email.smtp_port", data.port.trim() || "465"],
    ["email.smtp_user", data.user.trim()],
    ["email.from", data.from?.trim() || data.user.trim()],
  ];

  if (data.password && data.password.trim().length > 0) {
    const encryptedPassword = encrypt(data.password.trim());
    updates.push(["email.smtp_password", encryptedPassword]);
  }

  for (const [key, value] of updates) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  revalidatePath("/admin/settings/system");
  revalidatePath("/admin/emails");
  return { ok: true };
}

export async function testSmtpConnection(data?: {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "super_admin" && user.role !== "admin")) {
    return { ok: false, error: "Unauthorized" };
  }

  const nodemailer = (await import("nodemailer")).default;
  const { getEmailConfig } = await import("@/lib/email");

  let host = data?.host?.trim();
  let portStr = data?.port?.trim();
  let smtpUser = data?.user?.trim();
  let password = data?.password?.trim();

  // If parameters not completely provided, fallback to saved config
  if (!host || !smtpUser || !password) {
    const current = await getEmailConfig();
    if (!current) {
      return { ok: false, error: "Keine E-Mail-Konfiguration vorhanden." };
    }
    host = host || current.host;
    portStr = portStr || String(current.port);
    smtpUser = smtpUser || current.user;
    password = password || current.pass;
  }

  const port = parseInt(portStr || "465");
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: smtpUser,
      pass: password,
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
