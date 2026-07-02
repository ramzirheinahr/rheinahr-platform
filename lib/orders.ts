import { prisma } from "@/lib/prisma";
import type { Qualification } from "@prisma/client";

// Per the AÜG contracts, a request stays editable — even after the admin has
// processed it — until this many hours before its first shift starts.
export const EDIT_CUTOFF_HOURS = 4;

export type OrderEditLite = { shiftDate: Date; startTime: string; status: string };

// "Now" as naive German wall-clock ms, comparable with shiftDate (stored as
// UTC midnight) + startTime (German local "HH:mm").
function berlinNowMs(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const g = (t: Intl.DateTimeFormatPart["type"]) =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
}

// A request is editable until EDIT_CUTOFF_HOURS before its first shift starts,
// unless any shift already ran or the request was cancelled. After the cutoff
// the client contacts the office via message instead.
export function isRequestEditable(orders: OrderEditLite[]): boolean {
  if (orders.length === 0) return false;
  if (
    orders.some((o) =>
      ["in_progress", "completed", "confirmed", "cancelled"].includes(o.status),
    )
  ) {
    return false;
  }
  const firstStart = Math.min(
    ...orders.map((o) => o.shiftDate.getTime() + toMin(o.startTime) * 60_000),
  );
  return berlinNowMs() <= firstStart - EDIT_CUTOFF_HOURS * 3_600_000;
}

export type ExistingShift = {
  id: string;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  quantity: number;
  notes: string | null;
  requiredQualification: string;
};

export type IncomingShift = {
  date: string; // yyyy-mm-dd
  requiredQualification: string;
  startTime: string;
  endTime: string;
  quantity: number;
  notes: string | null;
};

// Minimal-change diff between a request's persisted shifts and an edited
// submission, so an edit only touches what actually changed: untouched shifts
// keep their orders (and assignments/confirmations); a shift whose only change
// is headcount or ward is updated in place; anything else is delete + create —
// only the modified shift loses its assignments.
export function diffRequestShifts(
  existing: ExistingShift[],
  incoming: IncomingShift[],
): {
  updates: { id: string; quantity: number; notes: string | null }[];
  creates: IncomingShift[];
  deleteIds: string[];
} {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const remaining = [...existing];
  const take = (pred: (e: ExistingShift) => boolean) => {
    const i = remaining.findIndex(pred);
    return i < 0 ? undefined : remaining.splice(i, 1)[0];
  };
  const updates: { id: string; quantity: number; notes: string | null }[] = [];
  const creates: IncomingShift[] = [];
  for (const s of incoming) {
    const sameSlot = (e: ExistingShift) =>
      iso(e.shiftDate) === s.date &&
      e.startTime === s.startTime &&
      e.endTime === s.endTime &&
      e.requiredQualification === s.requiredQualification;
    if (take((e) => sameSlot(e) && e.quantity === s.quantity && (e.notes ?? null) === s.notes)) {
      continue; // identical — leave the order untouched
    }
    const near = take(sameSlot);
    if (near) {
      updates.push({ id: near.id, quantity: s.quantity, notes: s.notes });
      continue;
    }
    creates.push(s);
  }
  return { updates, creates, deleteIds: remaining.map((e) => e.id) };
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
