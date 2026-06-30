"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { workerSchema } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

// Admin (or super_admin) may edit worker profiles — defense in depth alongside
// the admin layout guard. Account creation lives in /admin/accounts (super_admin).
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
}

function parseList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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

  const parsed = workerSchema.safeParse({
    fullName: formData.get("fullName"),
    qualification: formData.get("qualification"),
    contractType: formData.get("contractType"),
    phone: formData.get("phone") || undefined,
    address: formData.get("address") || undefined,
    certifications: parseList(formData.get("certifications")),
    languages: formData.getAll("languages").map(String),
  });
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  await prisma.worker.update({
    where: { id },
    data: {
      fullName: data.fullName,
      qualification: data.qualification,
      contractType: data.contractType,
      certifications: data.certifications,
      languages: data.languages,
      phone: data.phone,
      address: data.address,
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
