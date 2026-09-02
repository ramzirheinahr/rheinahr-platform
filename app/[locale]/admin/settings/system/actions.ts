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
