"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Worker toggles their availability for a day. Default (no record) = available;
// blocking a day stores an `unavailable` record that the matching engine honors.
// `makeAvailable=false` blocks the day; `true` clears the block.
export async function setAvailability(
  dateStr: string,
  makeAvailable: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") return { ok: false, error: "forbidden" };
  if (!dateRegex.test(dateStr)) return { ok: false, error: "saveError" };

  const worker = await prisma.worker.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!worker) return { ok: false, error: "saveError" };

  const date = new Date(`${dateStr}T00:00:00.000Z`);

  // Cannot change a day the worker is already scheduled for.
  const scheduled = await prisma.assignment.count({
    where: {
      workerId: worker.id,
      status: { not: "declined" },
      order: { shiftDate: date },
    },
  });
  if (scheduled > 0) return { ok: false, error: "scheduled" };

  if (makeAvailable) {
    await prisma.workerAvailability.deleteMany({
      where: { workerId: worker.id, date },
    });
  } else {
    await prisma.workerAvailability.upsert({
      where: { workerId_date: { workerId: worker.id, date } },
      update: { status: "unavailable" },
      create: { workerId: worker.id, date, status: "unavailable" },
    });
  }

  await audit({
    userId: user.id,
    action: "availability.set",
    entity: "Worker",
    entityId: worker.id,
    metadata: { date: dateStr, available: makeAvailable },
  });

  revalidatePath("/worker/availability");
  return { ok: true };
}
