"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateLoginToken, generatePin, roleUsesAccessLink } from "@/lib/access";
import {
  accountBaseSchema,
  workerProfileSchema,
  clientProfileSchema,
  updateAccountSchema,
  resetPasswordSchema,
  assignableRoles,
} from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

// Only a super_admin may provision accounts or assign roles (CLAUDE.md RBAC).
async function assertSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") throw new Error("forbidden");
  return user;
}

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createAccount(formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const base = accountBaseSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
  });
  const roleResult = z_enum(formData.get("role"));
  if (!base.success || !roleResult) return { ok: false, error: "saveError" };
  const role = roleResult;

  // Validate the role-specific profile up front.
  let workerData: ReturnType<typeof workerProfileSchema.parse> | null = null;
  let clientData: ReturnType<typeof clientProfileSchema.parse> | null = null;
  if (role === "worker") {
    const p = workerProfileSchema.safeParse({
      qualification: formData.get("qualification"),
      contractType: formData.get("contractType"),
      certifications: parseList(formData.get("certifications")),
      languages: formData.getAll("languages").map(String),
      phone: formData.get("phone") || undefined,
      address: formData.get("address") || undefined,
    });
    if (!p.success) return { ok: false, error: "saveError" };
    workerData = p.data;
  } else if (role === "client") {
    const p = clientProfileSchema.safeParse({
      facilityName: formData.get("facilityName"),
      facilityType: formData.get("facilityType"),
      address: formData.get("address") || undefined,
      contactPerson: formData.get("contactPerson") || undefined,
      billingInfo: formData.get("billingInfo") || undefined,
      surchargeSat: formData.get("surchargeSat") || undefined,
      surchargeSun: formData.get("surchargeSun") || undefined,
      surchargeHoliday: formData.get("surchargeHoliday") || undefined,
    });
    if (!p.success) return { ok: false, error: "saveError" };
    clientData = p.data;
  }

  const data = base.data;
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "emailInUse" };

  // 1) Provision the Supabase Auth login (email confirmed so they can sign in now).
  const supabase = createSupabaseAdminClient();
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { role },
  });
  if (authError || !created.user) {
    return { ok: false, error: "emailInUse" };
  }
  const authId = created.user.id;

  // 2) Create our records. If this fails, roll back the auth user.
  try {
    const passwordHash = await bcrypt.hash(data.password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: authId,
          email: data.email,
          fullName: data.fullName,
          role,
          passwordHash,
          createdById: actor.id,
        },
      });
      if (role === "worker" && workerData) {
        await tx.worker.create({
          data: {
            userId: authId,
            fullName: data.fullName,
            qualification: workerData.qualification,
            contractType: workerData.contractType,
            certifications: workerData.certifications,
            languages: workerData.languages,
            phone: workerData.phone,
            address: workerData.address,
          },
        });
      } else if (role === "client" && clientData) {
        await tx.client.create({
          data: {
            userId: authId,
            facilityName: clientData.facilityName,
            facilityType: clientData.facilityType,
            address: clientData.address,
            contactPerson: clientData.contactPerson,
            billingInfo: clientData.billingInfo,
            surchargeSat:
              clientData.surchargeSat === undefined
                ? null
                : clientData.surchargeSat / 100,
            surchargeSun:
              clientData.surchargeSun === undefined
                ? null
                : clientData.surchargeSun / 100,
            surchargeHoliday:
              clientData.surchargeHoliday === undefined
                ? null
                : clientData.surchargeHoliday / 100,
          },
        });
      }
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
    metadata: { role },
  });

  revalidatePath("/admin/accounts");
  return { ok: true };
}

export async function updateAccount(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  // A super_admin cannot change their own role or deactivate themselves.
  const parsed = updateAccountSchema.safeParse({
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) return { ok: false, error: "saveError" };

  const target = await prisma.user.findUnique({
    where: { id },
    select: { role: true },
  });
  if (!target) return { ok: false, error: "saveError" };
  if (id === actor.id) return { ok: false, error: "selfEdit" };
  if (target.role === "super_admin") return { ok: false, error: "forbidden" };

  await prisma.user.update({
    where: { id },
    data: {
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      active: parsed.data.active,
    },
  });

  await audit({
    userId: actor.id,
    action: "account.update",
    entity: "User",
    entityId: id,
    metadata: { role: parsed.data.role, active: parsed.data.active },
  });

  revalidatePath("/admin/accounts");
  revalidatePath(`/admin/accounts/${id}/edit`);
  return { ok: true };
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

  revalidatePath(`/admin/accounts/${id}/edit`);
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

  revalidatePath(`/admin/accounts/${id}/edit`);
  return { ok: true };
}

// Narrow a FormData value to an assignable role, or null.
function z_enum(value: FormDataEntryValue | null) {
  const v = String(value ?? "");
  return (assignableRoles as readonly string[]).includes(v)
    ? (v as (typeof assignableRoles)[number])
    : null;
}
