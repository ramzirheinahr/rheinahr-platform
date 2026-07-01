"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientSchema } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

// Admin (or super_admin) may edit facility profiles. Account creation lives in
// /admin/accounts (super_admin).
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
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

  const parsed = clientSchema.safeParse({
    facilityName: formData.get("facilityName"),
    facilityType: formData.get("facilityType"),
    address: formData.get("address") || undefined,
    contactPerson: formData.get("contactPerson") || undefined,
    billingInfo: formData.get("billingInfo") || undefined,
    surchargeSat: formData.get("surchargeSat") || undefined,
    surchargeSun: formData.get("surchargeSun") || undefined,
    surchargeHoliday: formData.get("surchargeHoliday") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;
  // Empty field → null (fall back to platform default); percent → fraction.
  const pctToFrac = (v: number | undefined) =>
    v === undefined ? null : v / 100;

  await prisma.client.update({
    where: { id },
    data: {
      facilityName: data.facilityName,
      facilityType: data.facilityType,
      address: data.address,
      contactPerson: data.contactPerson,
      billingInfo: data.billingInfo,
      surchargeSat: pctToFrac(data.surchargeSat),
      surchargeSun: pctToFrac(data.surchargeSun),
      surchargeHoliday: pctToFrac(data.surchargeHoliday),
    },
  });

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
