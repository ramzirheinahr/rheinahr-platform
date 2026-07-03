"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientSchema, accountBaseSchema } from "@/lib/validations";
import { Prisma } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

// Admin (or super_admin) may edit facility profiles. Creating a facility
// (= its login account) is super_admin-only, like all account provisioning.
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
}

async function assertSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") throw new Error("forbidden");
  return user;
}

function parseProfile(formData: FormData) {
  return clientSchema.safeParse({
    facilityName: formData.get("facilityName"),
    shortCode: formData.get("shortCode"),
    facilityType: formData.get("facilityType"),
    address: formData.get("address") || undefined,
    contactPerson: formData.get("contactPerson") || undefined,
    billingInfo: formData.get("billingInfo") || undefined,
    surchargeSat: formData.get("surchargeSat") || undefined,
    surchargeSun: formData.get("surchargeSun") || undefined,
    surchargeHoliday: formData.get("surchargeHoliday") || undefined,
    ratePflegefachkraft: formData.get("ratePflegefachkraft") || undefined,
    ratePflegehelfer: formData.get("ratePflegehelfer") || undefined,
    rateBetreuungskraft: formData.get("rateBetreuungskraft") || undefined,
    ratePflegedienstleitung: formData.get("ratePflegedienstleitung") || undefined,
  });
}

// Empty field → null (fall back to platform default); percent → fraction.
const pctToFrac = (v: number | undefined) => (v === undefined ? null : v / 100);

// The four per-qualification rate fields → the JSON override map stored on the
// client. Only fields the admin actually filled are kept; all blank → null so
// the facility falls back to the platform defaults for everything.
function ratesJson(data: {
  ratePflegefachkraft?: number;
  ratePflegehelfer?: number;
  rateBetreuungskraft?: number;
  ratePflegedienstleitung?: number;
}): Record<string, number> | null {
  const map: Record<string, number> = {};
  if (data.ratePflegefachkraft !== undefined) map.pflegefachkraft = data.ratePflegefachkraft;
  if (data.ratePflegehelfer !== undefined) map.pflegehelfer = data.ratePflegehelfer;
  if (data.rateBetreuungskraft !== undefined) map.betreuungskraft = data.rateBetreuungskraft;
  if (data.ratePflegedienstleitung !== undefined)
    map.pflegedienstleitung = data.ratePflegedienstleitung;
  return Object.keys(map).length ? map : null;
}

// Creating a facility provisions its login in the same step: Supabase Auth
// user + our User row + the Client profile.
export async function createClient(formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const profile = parseProfile(formData);
  if (!profile.success) return { ok: false, error: "saveError" };
  const data = profile.data;
  // The account display name is the contact person, falling back to the facility.
  const base = accountBaseSchema.safeParse({
    email: formData.get("email"),
    fullName: data.contactPerson || data.facilityName,
    password: formData.get("password"),
  });
  if (!base.success) return { ok: false, error: "saveError" };

  const existing = await prisma.user.findUnique({
    where: { email: base.data.email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "emailInUse" };

  if (data.shortCode) {
    const codeTaken = await prisma.client.findUnique({
      where: { shortCode: data.shortCode },
      select: { id: true },
    });
    if (codeTaken) return { ok: false, error: "codeInUse" };
  }

  // 1) Provision the Supabase Auth login (email confirmed so they can sign in now).
  const supabase = createSupabaseAdminClient();
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: base.data.email,
    password: base.data.password,
    email_confirm: true,
    user_metadata: { role: "client" },
  });
  if (authError || !created.user) return { ok: false, error: "emailInUse" };
  const authId = created.user.id;

  // 2) Create our records. If this fails, roll back the auth user.
  try {
    const passwordHash = await bcrypt.hash(base.data.password, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: authId,
          email: base.data.email,
          fullName: base.data.fullName,
          role: "client",
          passwordHash,
          createdById: actor.id,
        },
      });
      await tx.client.create({
        data: {
          userId: authId,
          facilityName: data.facilityName,
          shortCode: data.shortCode ?? null,
          facilityType: data.facilityType,
          address: data.address,
          contactPerson: data.contactPerson,
          billingInfo: data.billingInfo,
          surchargeSat: pctToFrac(data.surchargeSat),
          surchargeSun: pctToFrac(data.surchargeSun),
          surchargeHoliday: pctToFrac(data.surchargeHoliday),
          hourlyRates: ratesJson(data) ?? undefined,
        },
      });
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
    metadata: { role: "client" },
  });

  revalidatePath("/admin/clients");
  return { ok: true };
}

export async function updateClient(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = parseProfile(formData);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  try {
    await prisma.client.update({
      where: { id },
      data: {
        facilityName: data.facilityName,
        shortCode: data.shortCode ?? null,
        facilityType: data.facilityType,
        address: data.address,
        contactPerson: data.contactPerson,
        billingInfo: data.billingInfo,
        surchargeSat: pctToFrac(data.surchargeSat),
        surchargeSun: pctToFrac(data.surchargeSun),
        surchargeHoliday: pctToFrac(data.surchargeHoliday),
        hourlyRates: ratesJson(data) ?? Prisma.JsonNull,
        // Keep the account display name in sync with the profile.
        user: {
          update: { fullName: data.contactPerson || data.facilityName },
        },
      },
    });
  } catch (e) {
    // P2002 = another facility already uses this Dienstplan-Kürzel.
    const dup = typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
    return { ok: false, error: dup ? "codeInUse" : "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "client.update",
    entity: "Client",
    entityId: id,
  });

  revalidatePath("/admin/clients");
  revalidatePath(`/admin/clients/${id}/edit`);
  return { ok: true };
}

// GDPR erasure — removing the User cascades to the Client and its orders.
export async function deleteClient(id: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const client = await prisma.client.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  await prisma.user.delete({ where: { id: client.userId } });

  await audit({
    userId: admin.id,
    action: "client.delete",
    entity: "Client",
    entityId: id,
  });

  revalidatePath("/admin/clients");
  return { ok: true };
}
