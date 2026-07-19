"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export type ActionState = { ok: boolean; error?: string };

const adminUserSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12).optional(),
  active: z.boolean(),
  permissions: z.array(z.string()),
});

export async function createAdminUser(
  locale: string,
  formData: FormData,
): Promise<ActionState> {
  let actor;
  try {
    // @ts-expect-error locale type
    actor = await requireSuperAdmin(locale);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const permissions = formData.getAll("permissions") as string[];
  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    active: formData.get("active") === "on",
    permissions,
  };

  const parsed = adminUserSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.password) return { ok: false, error: "saveError" };
  const data = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "emailInUse" };

  const supabase = createSupabaseAdminClient();
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { role: "admin" },
  });
  if (authError || !created.user) return { ok: false, error: "emailInUse" };
  const authId = created.user.id;

  try {
    const passwordHash = await bcrypt.hash(data.password!, 12);
    await prisma.user.create({
      data: {
        id: authId,
        email: data.email,
        fullName: data.fullName,
        role: "admin",
        passwordHash,
        active: data.active,
        permissions: data.permissions,
        createdById: actor.id,
      },
    });
  } catch {
    await supabase.auth.admin.deleteUser(authId).catch(() => {});
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: actor.id,
    action: "account.create",
    entity: "User",
    entityId: authId,
    metadata: { role: "admin" },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function updateAdminUser(
  locale: string,
  id: string,
  formData: FormData,
): Promise<ActionState> {
  let actor;
  try {
    // @ts-expect-error locale type
    actor = await requireSuperAdmin(locale);
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const permissions = formData.getAll("permissions") as string[];
  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    active: formData.get("active") === "on",
    permissions,
  };

  const parsed = adminUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  const userToUpdate = await prisma.user.findUnique({ where: { id } });
  if (!userToUpdate || userToUpdate.role === "super_admin") {
    return { ok: false, error: "forbidden" };
  }

  try {
    await prisma.user.update({
      where: { id },
      data: {
        fullName: data.fullName,
        active: data.active,
        permissions: data.permissions,
      },
    });
  } catch {
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: actor.id,
    action: "account.update",
    entity: "User",
    entityId: id,
    metadata: { role: "admin" },
  });

  revalidatePath("/admin/users");
  return { ok: true };
}
