import { prisma } from "@/lib/prisma";
import type { Qualification } from "@prisma/client";
import {
  availabilityLetters,
  facilityCode,
  shiftLetterForStart,
  type GridDay,
  type GridFacility,
  type GridWorkerRow,
  type UnavailBlockLite,
} from "@/lib/master-schedule-core";

// DB layer of the master schedule grid — assembles one month of one
// qualification's workers into GridWorkerRow[]. All grid semantics (letters,
// codes, presets) live in lib/master-schedule-core.ts.

export type MasterSchedule = {
  rows: GridWorkerRow[];
  facilities: GridFacility[];
  daysInMonth: number;
};

export async function getMasterSchedule(
  qualification: Qualification,
  year: number,
  month: number,
): Promise<MasterSchedule> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const [workers, facilities] = await Promise.all([
    prisma.worker.findMany({
      where: { qualification, user: { active: true } },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        availability: {
          where: { status: "unavailable", date: { gte: monthStart, lt: monthEnd } },
          select: { date: true, startTime: true, endTime: true },
        },
        assignments: {
          where: {
            status: { not: "declined" },
            order: {
              shiftDate: { gte: monthStart, lt: monthEnd },
              status: { not: "cancelled" },
            },
          },
          select: {
            id: true,
            status: true,
            order: {
              select: {
                id: true,
                shiftDate: true,
                startTime: true,
                endTime: true,
                notes: true,
                client: { select: { shortCode: true, facilityName: true } },
              },
            },
            serviceConfirmation: { select: { id: true } },
          },
        },
      },
    }),
    prisma.client.findMany({
      orderBy: { facilityName: "asc" },
      select: { id: true, shortCode: true, facilityName: true },
    }),
  ]);

  const rows: GridWorkerRow[] = workers.map((w) => {
    const days: GridDay[] = Array.from({ length: daysInMonth }, () => ({
      avail: "FSN",
      hasBlocks: false,
      jobs: [],
    }));

    const blocksByDay = new Map<number, UnavailBlockLite[]>();
    for (const b of w.availability) {
      const day = b.date.getUTCDate();
      const list = blocksByDay.get(day) ?? [];
      list.push({ startTime: b.startTime, endTime: b.endTime });
      blocksByDay.set(day, list);
    }
    blocksByDay.forEach((blocks, day) => {
      days[day - 1].avail = availabilityLetters(blocks);
      days[day - 1].hasBlocks = true;
    });

    for (const a of w.assignments) {
      const day = a.order.shiftDate.getUTCDate();
      days[day - 1].jobs.push({
        assignmentId: a.id,
        orderId: a.order.id,
        letter: shiftLetterForStart(a.order.startTime),
        code: facilityCode(a.order.client.shortCode, a.order.client.facilityName),
        facilityName: a.order.client.facilityName,
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        ward: a.order.notes,
        status: a.status as "pending" | "confirmed",
        clientConfirmed: a.serviceConfirmation !== null,
      });
    }
    for (const d of days) {
      d.jobs.sort((x, y) => x.startTime.localeCompare(y.startTime));
    }

    return { workerId: w.id, name: w.fullName, days };
  });

  return {
    rows,
    facilities: facilities.map((f) => ({
      clientId: f.id,
      code: facilityCode(f.shortCode, f.facilityName),
      name: f.facilityName,
      hasCode: f.shortCode !== null,
    })),
    daysInMonth,
  };
}
