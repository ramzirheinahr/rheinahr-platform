"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export type ActionState = { ok: boolean; error?: string };

const clientSubUserSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12).optional(),
  jobTitle: z.string().optional(),
  active: z.boolean(),
});

export async function createClientSubUser(
  formData: FormData,
  targetClientId?: string
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "forbidden" };

  let clientId = targetClientId;

  if (actor.role === "client") {
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      include: { client: { select: { id: true } } },
    });
    if (!actorUser?.client?.id) return { ok: false, error: "forbidden" };
    clientId = actorUser.client.id;
  } else if (actor.role !== "admin" && actor.role !== "super_admin") {
    return { ok: false, error: "forbidden" };
  }

  if (!clientId) return { ok: false, error: "saveError" };

  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    jobTitle: formData.get("jobTitle"),
    active: formData.get("active") === "on",
  };

  const parsed = clientSubUserSchema.safeParse(raw);
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
    user_metadata: { role: "client" },
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
        role: "client",
        passwordHash,
        active: data.active,
        jobTitle: data.jobTitle,
        clientId, // Link to the same facility
        createdById: actor.id,
      },
    });
  } catch {
    await supabase.auth.admin.deleteUser(authId).catch(() => {});
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: actor.id,
    action: "clientUser.create",
    entity: "User",
    entityId: authId,
    metadata: { clientId },
  });

  revalidatePath("/client/settings");
  return { ok: true };
}

export async function updateClientSubUser(
  id: string,
  formData: FormData,
  targetClientId?: string
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "forbidden" };

  let allowedClientId = targetClientId;
  
  if (actor.role === "client") {
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      include: { client: { select: { id: true } } },
    });
    if (!actorUser?.client?.id) return { ok: false, error: "forbidden" };
    allowedClientId = actorUser.client.id;
  } else if (actor.role !== "admin" && actor.role !== "super_admin") {
    return { ok: false, error: "forbidden" };
  }

  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password") || undefined,
    jobTitle: formData.get("jobTitle"),
    active: formData.get("active") === "on",
  };

  const parsed = clientSubUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  // Make sure the sub-user belongs to this client (or the admin is managing it)
  const targetUser = await prisma.user.findUnique({ where: { id } });
  if (!targetUser) return { ok: false, error: "saveError" };
  if (allowedClientId && targetUser.clientId !== allowedClientId) {
    return { ok: false, error: "forbidden" };
  }

  // Handle email change if needed
  if (data.email !== targetUser.email) {
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existing && existing.id !== id) {
      return { ok: false, error: "emailInUse" };
    }
    const supabase = createSupabaseAdminClient();
    const { error: authErr } = await supabase.auth.admin.updateUserById(id, {
      email: data.email,
      email_confirm: true,
    });
    if (authErr) {
      return { ok: false, error: "emailInUse" };
    }
  }

  // Handle optional password update
  let newPasswordHash: string | undefined = undefined;
  if (data.password) {
    if (data.password.length < 12) {
      return { ok: false, error: "passwordMinLength" };
    }
    newPasswordHash = await bcrypt.hash(data.password, 12);
    const supabase = createSupabaseAdminClient();
    await supabase.auth.admin.updateUserById(id, { password: data.password }).catch(() => {});
  }

  try {
    await prisma.user.update({
      where: { id },
      data: {
        fullName: data.fullName,
        email: data.email,
        jobTitle: data.jobTitle,
        active: data.active,
        ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
      },
    });
  } catch {
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: actor.id,
    action: "clientUser.update",
    entity: "User",
    entityId: id,
  });

  revalidatePath("/client/settings");
  return { ok: true };
}

export async function deleteClientSubUser(
  id: string,
  targetClientId?: string
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "forbidden" };

  let allowedClientId = targetClientId;
  
  if (actor.role === "client") {
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      include: { client: { select: { id: true } } },
    });
    if (!actorUser?.client?.id) return { ok: false, error: "forbidden" };
    allowedClientId = actorUser.client.id;
  } else if (actor.role !== "admin" && actor.role !== "super_admin") {
    return { ok: false, error: "forbidden" };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    include: { client: { select: { id: true } } },
  });

  if (!targetUser) return { ok: false, error: "saveError" };

  // Never allow deleting the facility primary user!
  if (targetUser.client) {
    return { ok: false, error: "cannotDeleteMainUser" };
  }

  if (allowedClientId && targetUser.clientId !== allowedClientId) {
    return { ok: false, error: "forbidden" };
  }

  // Delete from Supabase Auth
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.auth.admin.deleteUser(id);
  } catch (err) {
    console.warn("Supabase user delete skipped or failed:", err);
  }

  // Delete from Prisma (cascades sessions, appointments, etc.)
  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    console.error("Failed to delete user in Prisma:", err);
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: actor.id,
    action: "clientUser.delete",
    entity: "User",
    entityId: id,
    metadata: { clientId: allowedClientId || null },
  });

  revalidatePath("/client/settings");
  return { ok: true };
}

import { createPasswordResetToken } from "@/lib/password-reset";

export async function sendSubUserPasswordResetEmail(
  id: string,
  locale: string = "de",
  targetClientId?: string
): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "forbidden" };

  let allowedClientId = targetClientId;
  
  if (actor.role === "client") {
    const actorUser = await prisma.user.findUnique({
      where: { id: actor.id },
      include: { client: { select: { id: true } } },
    });
    if (!actorUser?.client?.id) return { ok: false, error: "forbidden" };
    allowedClientId = actorUser.client.id;
  } else if (actor.role !== "admin" && actor.role !== "super_admin") {
    return { ok: false, error: "forbidden" };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, clientId: true },
  });

  if (!targetUser) return { ok: false, error: "saveError" };
  if (allowedClientId && targetUser.clientId !== allowedClientId) {
    return { ok: false, error: "forbidden" };
  }

  await createPasswordResetToken(targetUser.email, locale);

  await audit({
    userId: actor.id,
    action: "clientUser.send_reset_email",
    entity: "User",
    entityId: id,
  });

  return { ok: true };
}

export async function updateMyEmail(formData: FormData): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== "client") return { ok: false, error: "forbidden" };

  const email = formData.get("email")?.toString();
  if (!email) return { ok: false, error: "saveError" };

  const current = await prisma.user.findUnique({ where: { id: actor.id }, select: { email: true } });
  if (current?.email === email) return { ok: true };

  const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (clash && clash.id !== actor.id) return { ok: false, error: "emailInUse" };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(actor.id, {
    email,
    email_confirm: true, // Auto-confirm for simplicity as requested by user
  });

  if (error) {
    return { ok: false, error: "emailInUse" };
  }

  await prisma.user.update({ where: { id: actor.id }, data: { email } });
  
  await audit({
    userId: actor.id,
    action: "account.update_my_email",
    entity: "User",
    entityId: actor.id,
  });
  
  return { ok: true };
}

export async function updateMyPassword(formData: FormData): Promise<ActionState> {
  const actor = await getCurrentUser();
  if (!actor || actor.role !== "client") return { ok: false, error: "forbidden" };

  const password = formData.get("password")?.toString();
  if (!password || password.length < 12) return { ok: false, error: "saveError" };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(actor.id, { password });
  if (error) return { ok: false, error: "saveError" };

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash } });
  
  await audit({
    userId: actor.id,
    action: "account.update_my_password",
    entity: "User",
    entityId: actor.id,
  });
  
  return { ok: true };
}
