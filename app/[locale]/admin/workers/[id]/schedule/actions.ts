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

  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath(`/worker`);
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
