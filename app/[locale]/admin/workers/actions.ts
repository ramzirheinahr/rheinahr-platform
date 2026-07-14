"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { workerSchema, accountBaseSchema } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

// Admin (or super_admin) may edit worker profiles — defense in depth alongside
// the admin layout guard. Creating a worker (= their login account) is
// super_admin-only, like all account provisioning.
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

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseProfile(formData: FormData) {
  return workerSchema.safeParse({
    fullName: formData.get("fullName"),
    qualification: formData.get("qualification"),
    contractType: formData.get("contractType"),
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    certifications: parseList(formData.get("certifications")),
    skills: parseList(formData.get("skills")),
    languages: formData.getAll("languages").map(String),
    birthDate: formData.get("birthDate") || undefined,
    birthPlace: formData.get("birthPlace") || undefined,
    nationality: formData.get("nationality") || undefined,
    socialSecurityNumber: formData.get("socialSecurityNumber") || undefined,
    bio: formData.get("bio") || undefined,
    yearsExperience: formData.get("yearsExperience") || undefined,
    employedSince: formData.get("employedSince") || undefined,
    requiredHours: formData.get("requiredHours") || undefined,
    carryoverHours: formData.get("carryoverHours") || undefined,
    travelAllowanceEnabled: formData.get("travelAllowanceEnabled") === "on",
    travelAllowancePerKm: formData.get("travelAllowancePerKm") || undefined,
    mealAllowanceEnabled: formData.get("mealAllowanceEnabled") === "on",
    mealAllowance: formData.get("mealAllowance") || undefined,
    surchargeSat: formData.get("surchargeSat") || undefined,
    surchargeSun: formData.get("surchargeSun") || undefined,
    surchargeHoliday: formData.get("surchargeHoliday") || undefined,
    surchargeNight: formData.get("surchargeNight") || undefined,
    nightStart: formData.get("nightStart") || undefined,
    nightEnd: formData.get("nightEnd") || undefined,
    ratePflegefachkraft: formData.get("ratePflegefachkraft") || undefined,
    ratePflegehelfer: formData.get("ratePflegehelfer") || undefined,
    rateBetreuungskraft: formData.get("rateBetreuungskraft") || undefined,
    ratePflegedienstleitung: formData.get("ratePflegedienstleitung") || undefined,
    employmentStartDate: formData.get("employmentStartDate") || undefined,
    employmentEndDate: formData.get("employmentEndDate") || undefined,
  });
}

// Map validated profile input to Prisma columns. Empty optionals become null so
// clearing a field in the form actually clears it on update.
type ProfileInput = ReturnType<typeof workerSchema.parse>;
function toWorkerColumns(d: ProfileInput) {
  // Extract non-null custom rates to a JSON map
  const rates: Record<string, number> = {};
  if (d.ratePflegefachkraft != null) rates.pflegefachkraft = d.ratePflegefachkraft;
  if (d.ratePflegehelfer != null) rates.pflegehelfer = d.ratePflegehelfer;
  if (d.rateBetreuungskraft != null) rates.betreuungskraft = d.rateBetreuungskraft;
  if (d.ratePflegedienstleitung != null) rates.pflegedienstleitung = d.ratePflegedienstleitung;
  const hourlyRates = Object.keys(rates).length > 0 ? rates : null;

  return {
    fullName: d.fullName,
    internalNumber: d.internalNumber ?? null,
    qualification: d.qualification,
    contractType: d.contractType,
    certifications: d.certifications,
    skills: d.skills,
    languages: d.languages,
    phone: d.phone ?? null,
    address: d.address ?? null,
    birthDate: d.birthDate ?? null,
    birthPlace: d.birthPlace ?? null,
    nationality: d.nationality ?? null,
    socialSecurityNumber: d.socialSecurityNumber ?? null,
    bio: d.bio ?? null,
    yearsExperience: d.yearsExperience ?? null,
    employedSince: d.employedSince ?? null,
    requiredHours: d.requiredHours,
    carryoverHours: d.carryoverHours,
    travelAllowanceEnabled: d.travelAllowanceEnabled,
    travelAllowancePerKm: d.travelAllowancePerKm ?? null,
    mealAllowanceEnabled: d.mealAllowanceEnabled,
    mealAllowance: d.mealAllowance ?? null,
    surchargeSat: d.surchargeSat != null ? d.surchargeSat / 100 : null,
    surchargeSun: d.surchargeSun != null ? d.surchargeSun / 100 : null,
    surchargeHoliday: d.surchargeHoliday != null ? d.surchargeHoliday / 100 : null,
    surchargeNight: d.surchargeNight != null ? d.surchargeNight / 100 : null,
    nightStart: d.nightStart ?? null,
    nightEnd: d.nightEnd ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hourlyRates: hourlyRates ? (hourlyRates as any) : null,
    employmentStartDate: d.employmentStartDate ?? null,
    employmentEndDate: d.employmentEndDate ?? null,
  };
}

// Creating a worker provisions their login in the same step: Supabase Auth
// user + our User row + the Worker profile.
export async function createWorker(formData: FormData): Promise<ActionState> {
  let actor;
  try {
    actor = await assertSuperAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const profile = parseProfile(formData);
  const base = accountBaseSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
  });
  if (!profile.success || !base.success) return { ok: false, error: "saveError" };
  const data = profile.data;

  const existing = await prisma.user.findUnique({
    where: { email: base.data.email },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "emailInUse" };

  // 1) Provision the Supabase Auth login (email confirmed so they can sign in now).
  const supabase = createSupabaseAdminClient();
  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: base.data.email,
    password: base.data.password,
    email_confirm: true,
    user_metadata: { role: "worker" },
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
          fullName: data.fullName,
          receiveEmails: formData.get("receiveEmails") === "on",
          role: "worker",
          passwordHash,
          createdById: actor.id,
        },
      });
      await tx.worker.create({
        data: { userId: authId, ...toWorkerColumns(data) },
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
    metadata: { role: "worker" },
  });

  revalidatePath("/admin/workers");
  return { ok: true };
}

export async function updateWorker(
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

  await prisma.worker.update({
    where: { id },
    data: {
      ...toWorkerColumns(data),
      // Keep the account display name in sync with the profile.
      user: { 
        update: { 
          fullName: data.fullName,
          receiveEmails: formData.get("receiveEmails") === "on"
        } 
      },
    },
  });

  await audit({
    userId: admin.id,
    action: "worker.update",
    entity: "Worker",
    entityId: id,
  });

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${id}/edit`);
  return { ok: true };
}

// GDPR erasure — removing the User cascades to the Worker and its relations.
export async function deleteWorker(id: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const worker = await prisma.worker.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!worker) return { ok: false, error: "saveError" };

  await prisma.user.delete({ where: { id: worker.userId } });

  await audit({
    userId: admin.id,
    action: "worker.delete",
    entity: "Worker",
    entityId: id,
  });

  revalidatePath("/admin/workers");
  return { ok: true };
}
