"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateLoginToken, generatePin, roleUsesAccessLink } from "@/lib/access";
import { resetPasswordSchema, updateEmailSchema } from "@/lib/validations";

// Account-level actions (login credentials, access link, active flag) shared by
// the worker and client edit pages — accounts have no page of their own anymore.
// Only a super_admin may touch login credentials (CLAUDE.md RBAC).

export type ActionState = { ok: boolean; error?: string };

async function assertSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") throw new Error("forbidden");
  return user;
}

export async function resetAccountPassword(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "saveError" };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(id, {
    password: parsed.data.password,
  });
  if (error) return { ok: false, error: "saveError" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  await audit({
    userId: actor.id,
    action: "account.reset_password",
    entity: "User",
    entityId: id,
  });
  return { ok: true };
}

// Change the account's login email. It is the Supabase Auth identity, so we
// update Auth first (email_confirm so the user can sign in immediately) and
// mirror it onto our User row. Returns "emailInUse" if the address is taken.
export async function updateAccountEmail(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = updateEmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: "saveError" };
  const email = parsed.data.email;

  const current = await prisma.user.findUnique({
    where: { id },
    select: { email: true },
  });
  if (!current) return { ok: false, error: "saveError" };
  if (current.email === email) return { ok: true }; // no-op

  const clash = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (clash && clash.id !== id) return { ok: false, error: "emailInUse" };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(id, {
    email,
    email_confirm: true,
  });
  if (error) {
    // Only report "email in use" when Auth actually rejects a duplicate;
    // other failures (e.g. the Auth user is missing) must not masquerade as that.
    const msg = error.message?.toLowerCase() ?? "";
    const duplicate =
      msg.includes("already") || msg.includes("registered") || msg.includes("exists");
    return { ok: false, error: duplicate ? "emailInUse" : "saveError" };
  }

  await prisma.user.update({ where: { id }, data: { email } });

  await audit({
    userId: actor.id,
    action: "account.update_email",
    entity: "User",
    entityId: id,
  });

  revalidatePath("/admin/workers");
  revalidatePath("/admin/clients");
  return { ok: true };
}

// Enable/disable sign-in without deleting the profile.
export async function setAccountActive(
  id: string,
  active: boolean,
): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (id === actor.id) return { ok: false, error: "forbidden" };
  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });
  if (!target) return { ok: false, error: "saveError" };
  if (target.role === "super_admin") return { ok: false, error: "forbidden" };

  await prisma.user.update({ where: { id }, data: { active } });

  await audit({
    userId: actor.id,
    action: "account.update",
    entity: "User",
    entityId: id,
    metadata: { active },
  });

  revalidatePath("/admin/workers");
  revalidatePath("/admin/clients");
  return { ok: true };
}

export type AccessLinkState = {
  ok: boolean;
  error?: string;
  token?: string; // the /access/<token> slug (shown so the admin can copy the link)
  pin?: string; // the 6-digit PIN — returned in plaintext ONCE, never stored readable
};

// Generate (or regenerate) a passwordless access link + PIN for a client/worker.
// Regenerating rotates both secrets, invalidating any previously shared link/PIN
// and clearing lockout state. The PIN is returned once and only its hash is kept.
export async function generateAccessLink(id: string): Promise<AccessLinkState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true, active: true },
  });
  if (!target) return { ok: false, error: "saveError" };
  if (!roleUsesAccessLink(target.role)) return { ok: false, error: "forbidden" };

  const token = generateLoginToken();
  const pin = generatePin();
  const loginPinHash = await bcrypt.hash(pin, 12);

  await prisma.user.update({
    where: { id },
    data: {
      loginToken: token,
      loginPinHash,
      loginPinAttempts: 0,
      loginPinLockUntil: null,
    },
  });

  await audit({
    userId: actor.id,
    action: "account.access_link.generate",
    entity: "User",
    entityId: id,
  });

  return { ok: true, token, pin };
}

// Revoke the access link + PIN entirely (e.g. lost device). Email login remains.
export async function revokeAccessLink(id: string): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  await prisma.user.update({
    where: { id },
    data: {
      loginToken: null,
      loginPinHash: null,
      loginPinAttempts: 0,
      loginPinLockUntil: null,
    },
  });

  await audit({
    userId: actor.id,
    action: "account.access_link.revoke",
    entity: "User",
    entityId: id,
  });

  return { ok: true };
}
