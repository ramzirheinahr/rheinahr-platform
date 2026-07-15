"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export type AvailBlock = {
  date: string;
  startTime: string | null; // null = whole day available
  endTime: string | null;
};

// Replaces the worker's positive availability for one month (local edits saved
// in one go). Availability is opt-in: only declared windows are stored; a block
// with null times means the worker is available the whole day. Days with no
// block are undeclared (not offered). Admins pass `workerId` to edit on the
// worker's behalf; workers can only ever edit their own calendar.
export async function saveAvailability(
  year: number,
  month: number,
  blocks: AvailBlock[],
  workerId?: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };
  if (month < 1 || month > 12 || year < 2020 || year > 2100)
    return { ok: false, error: "saveError" };

  const isStaff = user.role === "admin" || user.role === "super_admin";
  if (!isStaff && user.role !== "worker") return { ok: false, error: "forbidden" };

  const worker = isStaff
    ? workerId
      ? await prisma.worker.findUnique({ where: { id: workerId }, include: { user: { select: { fullName: true } } } })
      : null
    : await prisma.worker.findUnique({ where: { userId: user.id }, include: { user: { select: { fullName: true } } } });
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
        status: (b.startTime === null && b.endTime === null) ? "unavailable" : "available",
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
    metadata: { year, month, blocks: clean.length, actorRole: user.role },
  });

  if (!isStaff) {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, receiveEmails: true },
      select: { id: true },
    });
    
    if (admins.length > 0) {
      const { sendEmailToUsers } = await import("@/lib/email");
      const adminIds = admins.map((a) => a.id);
      
      const sortedBlocks = [...clean].sort((a, b) => a.date.localeCompare(b.date));
      const blocksList = sortedBlocks.length > 0 
        ? sortedBlocks.map((b) => {
            const time = b.startTime === null && b.endTime === null 
              ? "Ganztägig" 
              : `${b.startTime} - ${b.endTime}`;
            return `- ${b.date}: ${time}`;
          }).join("\n")
        : "Keine Zeiten angegeben (Verfügbarkeit gelöscht/leer).";
        
      const fullName = worker.user?.fullName || "Ein Mitarbeiter";
      const subject = `Verfügbarkeit aktualisiert: ${fullName}`;
      const body = `Der Mitarbeiter ${fullName} hat seine Verfügbarkeit für ${month}/${year} aktualisiert.\n\nEingereichte Zeiten:\n${blocksList}\n\nBitte prüfen Sie den Dienstplan im Admin-Bereich.`;
      
      await sendEmailToUsers(adminIds, { subject, body }).catch(console.error);
    }
  }

  revalidatePath("/worker");
  revalidatePath(`/admin/workers/${worker.id}/schedule`);
  revalidatePath("/admin/schedule");
  return { ok: true };
}
