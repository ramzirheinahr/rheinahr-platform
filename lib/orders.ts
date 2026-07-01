import { prisma } from "@/lib/prisma";
import type { Qualification } from "@prisma/client";

export type OrderStatusLite = { status: string; _count: { assignments: number } };

// A request is editable by the client only while every shift is still pending
// and nothing has been assigned (before any admin action).
export function isRequestEditable(orders: OrderStatusLite[]): boolean {
  return (
    orders.length > 0 &&
    orders.every((o) => o.status === "pending" && o._count.assignments === 0)
  );
}

export type Candidate = {
  workerId: string;
  fullName: string;
  email: string;
  status: "available" | "busy" | "unavailable";
  conflictTimes: string[]; // other same-day shifts (when busy)
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
// Two time ranges overlap (same-day comparison; sufficient for shift blocks).
const overlaps = (bs: string, be: string, s: string, e: string) =>
  toMin(bs) < toMin(e) && toMin(s) < toMin(be);

// Qualified workers for a shift, each flagged available / busy (already booked
// that day) / unavailable (marked off for that time). Busy workers are shown
// with a warning so the admin can still override; workers already on THIS shift
// are excluded.
export async function candidatesForShift(order: {
  id: string;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  requiredQualification: Qualification;
}): Promise<Candidate[]> {
  const workers = await prisma.worker.findMany({
    where: {
      qualification: order.requiredQualification,
      user: { active: true },
    },
    select: {
      id: true,
      fullName: true,
      user: { select: { email: true } },
      availability: {
        where: { date: order.shiftDate, status: "unavailable" },
        select: { startTime: true, endTime: true },
      },
      assignments: {
        where: {
          status: { not: "declined" },
          order: { shiftDate: order.shiftDate },
        },
        select: {
          order: { select: { id: true, startTime: true, endTime: true } },
        },
      },
    },
  });

  const list: Candidate[] = [];
  for (const w of workers) {
    const alreadyHere = w.assignments.some((a) => a.order.id === order.id);
    if (alreadyHere) continue; // shown in the assigned list, not as a candidate
    // Unavailable if a whole-day block exists, or a time block overlaps the shift.
    const unavailable = w.availability.some(
      (a) =>
        a.startTime === null ||
        a.endTime === null ||
        overlaps(a.startTime, a.endTime, order.startTime, order.endTime),
    );
    const others = w.assignments.filter((a) => a.order.id !== order.id);
    const status: Candidate["status"] = unavailable
      ? "unavailable"
      : others.length > 0
        ? "busy"
        : "available";
    list.push({
      workerId: w.id,
      fullName: w.fullName,
      email: w.user.email,
      status,
      conflictTimes: others.map((a) => `${a.order.startTime}–${a.order.endTime}`),
    });
  }

  const rank = { available: 0, busy: 1, unavailable: 2 } as const;
  return list.sort(
    (a, b) => rank[a.status] - rank[b.status] || a.fullName.localeCompare(b.fullName),
  );
}
