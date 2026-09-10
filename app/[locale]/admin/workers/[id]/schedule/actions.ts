"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addWorkerAdjustment(
  workerId: string,
  month: string,
  type: "k_ausgleich" | "sonstige",
  hours: number,
  notes: string
) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  await prisma.workerHoursAdjustment.create({
    data: {
      workerId,
      month,
      type,
      hours,
      notes,
    },
  });

  // Automatically sync note into Arbeitszeitkonto (azk.note) if notes is provided
  if (notes && notes.trim()) {
    const key = `azk.note.${workerId}.${month}`;
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    const trimmed = notes.trim();
    if (!existing || !existing.value) {
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: trimmed },
        update: { value: trimmed },
      });
    } else if (!existing.value.includes(trimmed)) {
      const updated = `${existing.value}; ${trimmed}`;
      await prisma.systemSetting.update({
        where: { key },
        data: { value: updated },
      });
    }
  }

  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath(`/admin/reports`);
  revalidatePath(`/worker`);
}

export async function saveWorkerMonthlyNoteAction(
  workerId: string,
  month: string,
  note: string
) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  const key = `azk.note.${workerId}.${month}`;
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: note },
    update: { value: note },
  });

  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath(`/admin/reports`);
  return { success: true };
}

export async function deleteWorkerAdjustment(id: string) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  const adj = await prisma.workerHoursAdjustment.findUnique({
    where: { id },
  });

  if (adj) {
    await prisma.workerHoursAdjustment.delete({
      where: { id },
    });
    revalidatePath(`/admin/workers/${adj.workerId}/schedule`);
    revalidatePath(`/worker`);
  }
}
