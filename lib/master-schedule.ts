import { prisma } from "@/lib/prisma";
import type { Qualification } from "@prisma/client";
import { netShiftHours } from "@/lib/pricing";
import {
  availabilityLetters,
  facilityCode,
  shiftLetterForStart,
  type GridDay,
  type GridFacility,
  type GridWorkerRow,
  type UnassignedShift,
  type AvailBlockLite,
} from "@/lib/master-schedule-core";

// DB layer of the master schedule grid — assembles one month of one
// qualification's workers into GridWorkerRow[]. All grid semantics (letters,
// codes, presets) live in lib/master-schedule-core.ts.

export type MasterSchedule = {
  rows: GridWorkerRow[];
  facilities: GridFacility[];
  unassigned: UnassignedShift[];
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

  const [workers, facilities, openOrders] = await Promise.all([
    prisma.worker.findMany({
      where: { qualification, user: { active: true } },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        fullName: true,
        requiredHours: true,
        carryoverHours: true,
        availability: {
          where: { date: { gte: monthStart, lt: monthEnd } },
          select: { date: true, startTime: true, endTime: true, status: true },
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
            cancelRequested: true,
            cancelNote: true,
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
            serviceConfirmation: { select: { id: true, hoursWorked: true } },
          },
        },
        leaveRequests: {
          where: {
            days: { some: { date: { gte: monthStart, lt: monthEnd } } }
          },
          select: {
            id: true,
            days: {
              where: { date: { gte: monthStart, lt: monthEnd } },
              select: { date: true, status: true, hours: true }
            }
          }
        },
      },
    }),
    prisma.client.findMany({
      orderBy: { facilityName: "asc" },
      select: { id: true, shortCode: true, facilityName: true },
    }),
    // Requested shifts of this qualification that still have open headcount —
    // the grey "not yet dispatched" section. Terminal states are excluded.
    prisma.order.findMany({
      where: {
        requiredQualification: qualification,
        shiftDate: { gte: monthStart, lt: monthEnd },
        status: { notIn: ["cancelled", "completed", "confirmed"] },
      },
      orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
      select: {
        id: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        quantity: true,
        notes: true,
        client: { select: { shortCode: true, facilityName: true } },
        assignments: { where: { status: { not: "declined" } }, select: { id: true } },
      },
    }),
  ]);

  const rows: GridWorkerRow[] = workers.map((w) => {
    // Availability is opt-in: undeclared days stay empty ("") until the worker
    // or an admin fills them in.
    const days: GridDay[] = Array.from({ length: daysInMonth }, () => ({
      avail: "",
      hasBlocks: false,
      jobs: [],
    }));

    const blocksByDay = new Map<number, (AvailBlockLite & { status: string })[]>();
    for (const b of w.availability) {
      const day = b.date.getUTCDate();
      const list = blocksByDay.get(day) ?? [];
      list.push({ startTime: b.startTime, endTime: b.endTime, status: b.status });
      blocksByDay.set(day, list);
    }
    blocksByDay.forEach((blocks, day) => {
      if (blocks.some(b => b.status === "unavailable")) {
        days[day - 1].avail = "OFF";
      } else {
        days[day - 1].avail = availabilityLetters(blocks);
      }
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
        cancelRequested: a.cancelRequested,
        cancelNote: a.cancelNote,
      });
    }
    for (const d of days) {
      d.jobs.sort((x, y) => x.startTime.localeCompare(y.startTime));
    }

    for (const req of w.leaveRequests) {
      for (const ld of req.days) {
        const day = ld.date.getUTCDate();
        days[day - 1].leave = {
          requestId: req.id,
          status: ld.status,
          hours: ld.hours,
        };
      }
    }

    let confirmedHours = w.assignments.reduce((sum, a) => {
      if (a.serviceConfirmation?.hoursWorked) {
        return sum + Number(a.serviceConfirmation.hoursWorked);
      }
      return sum;
    }, 0);

    let acceptedHours = w.assignments.reduce((sum, a) => {
      if (a.status === "confirmed" && !a.serviceConfirmation) {
        return sum + netShiftHours(a.order.startTime, a.order.endTime);
      }
      return sum;
    }, 0);

    for (const d of days) {
      if (d.leave?.status === "approved") {
        confirmedHours += d.leave.hours;
      }
    }

    return {
      workerId: w.id,
      name: w.fullName,
      requiredHours: w.requiredHours,
      carryoverHours: w.carryoverHours,
      confirmedHours,
      acceptedHours,
      days
    };
  });

  const unassigned: UnassignedShift[] = [];
  for (const o of openOrders) {
    const remaining = o.quantity - o.assignments.length;
    if (remaining <= 0) continue;
    unassigned.push({
      orderId: o.id,
      day: o.shiftDate.getUTCDate(),
      letter: shiftLetterForStart(o.startTime),
      code: facilityCode(o.client.shortCode, o.client.facilityName),
      facilityName: o.client.facilityName,
      startTime: o.startTime,
      endTime: o.endTime,
      ward: o.notes,
      remaining,
    });
  }

  return {
    rows,
    facilities: facilities.map((f) => ({
      clientId: f.id,
      code: facilityCode(f.shortCode, f.facilityName),
      name: f.facilityName,
      hasCode: f.shortCode !== null,
    })),
    unassigned,
    daysInMonth,
  };
}
