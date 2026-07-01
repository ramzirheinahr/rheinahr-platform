"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export type UnavailBlock = {
  date: string;
  startTime: string | null; // null = whole day
  endTime: string | null;
};

// Replaces the worker's unavailability blocks for one month (local edits saved
// in one go). A block with null times means the whole day is unavailable.
export async function saveAvailability(
  year: number,
  month: number,
  blocks: UnavailBlock[],
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") return { ok: false, error: "forbidden" };
  if (month < 1 || month > 12 || year < 2020 || year > 2100)
    return { ok: false, error: "saveError" };

  const worker = await prisma.worker.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!worker) return { ok: false, error: "saveError" };

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  // Validate & keep only blocks inside the month.
  const clean = blocks.filter((b) => {
    if (!dateRegex.test(b.date)) return false;
    const dt = new Date(`${b.date}T00:00:00.000Z`);
    if (dt < start || dt >= end) return false;
    const full = b.startTime === null && b.endTime === null;
    const ranged =
      b.startTime !== null &&
      b.endTime !== null &&
      timeRegex.test(b.startTime) &&
      timeRegex.test(b.endTime) &&
      b.startTime !== b.endTime;
    return full || ranged;
  });

  await prisma.$transaction([
    prisma.workerAvailability.deleteMany({
      where: { workerId: worker.id, date: { gte: start, lt: end } },
    }),
    prisma.workerAvailability.createMany({
      data: clean.map((b) => ({
        workerId: worker.id,
        date: new Date(`${b.date}T00:00:00.000Z`),
        status: "unavailable" as const,
        startTime: b.startTime,
        endTime: b.endTime,
      })),
    }),
  ]);

  await audit({
    userId: user.id,
    action: "availability.save",
    entity: "Worker",
    entityId: worker.id,
    metadata: { year, month, blocks: clean.length },
  });

  revalidatePath("/worker/availability");
  return { ok: true };
}
