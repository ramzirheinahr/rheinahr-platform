import { prisma } from "@/lib/prisma";
import { formatDateDE } from "@/lib/utils";
import type { Qualification } from "@/lib/validations";

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

// A request can be cancelled (soft) as long as none of its shifts is already
// confirmed / running / completed, and it is not already fully cancelled.
// Cancelling keeps the records (status → cancelled) — unlike editing it is not
// bound to the 4h cutoff, since the client should be able to call it off late.
export function isRequestCancelable(orders: { status: string }[]): boolean {
  if (orders.length === 0) return false;
  if (orders.every((o) => o.status === "cancelled")) return false;
  return !orders.some((o) =>
    ["in_progress", "completed", "confirmed"].includes(o.status),
  );
}

export type ExistingShift = {
  id: string;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  quantity: number;
  notes: string | null;
  requiredQualification: string;
};

export type IncomingShift = {
  date: string; // yyyy-mm-dd
  requiredQualification: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  quantity: number;
  notes: string | null;
};

// Minimal-change diff between a request's persisted shifts and an edited
// submission, so an edit only touches what actually changed: untouched shifts
// keep their orders (and assignments/confirmations); a shift whose only change
// is headcount, break or ward is updated in place; anything else is delete +
// create — only the modified shift loses its assignments.
export function diffRequestShifts(
  existing: ExistingShift[],
  incoming: IncomingShift[],
): {
  updates: { id: string; quantity: number; breakMinutes: number; notes: string | null }[];
  creates: IncomingShift[];
  deleteIds: string[];
} {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const remaining = [...existing];
  const take = (pred: (e: ExistingShift) => boolean) => {
    const i = remaining.findIndex(pred);
    return i < 0 ? undefined : remaining.splice(i, 1)[0];
  };
  const updates: { id: string; quantity: number; breakMinutes: number; notes: string | null }[] = [];
  const creates: IncomingShift[] = [];
  for (const s of incoming) {
    const sameSlot = (e: ExistingShift) =>
      iso(e.shiftDate) === s.date &&
      e.startTime === s.startTime &&
      e.endTime === s.endTime &&
      e.requiredQualification === s.requiredQualification;
    if (
      take(
        (e) =>
          sameSlot(e) &&
          e.quantity === s.quantity &&
          e.breakMinutes === s.breakMinutes &&
          (e.notes ?? null) === s.notes,
      )
    ) {
      continue; // identical — leave the order untouched
    }
    const near = take(sameSlot);
    if (near) {
      updates.push({ id: near.id, quantity: s.quantity, breakMinutes: s.breakMinutes, notes: s.notes });
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
        where: { date: order.shiftDate, status: "available" },
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
    // Positive availability: a worker is offerable only if they declared this
    // window (whole-day block, or a block overlapping the shift). No
    // declaration → not available (undeclared), the admin may still override.
    const declared = w.availability.some(
      (a) =>
        (a.startTime === null && a.endTime === null) ||
        (a.startTime !== null &&
          a.endTime !== null &&
          overlaps(a.startTime, a.endTime, order.startTime, order.endTime)),
    );
    const others = w.assignments.filter((a) => a.order.id !== order.id);
    const status: Candidate["status"] = !declared
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

export type BulkShift = {
  id: string;
  label: string; // "dd.mm.yyyy · HH:mm–HH:mm"
  requiredQualification: Qualification;
};

export type BulkCandidate = {
  workerId: string;
  fullName: string;
  email: string;
  qualification: Qualification;
  availableCount: number; // selected shifts they can take
  busyCount: number; // selected shifts where they're booked elsewhere
  unavailableCount: number; // selected shifts they didn't declare for
  eligibleOrderIds: string[]; // selected shifts matching their qualification (not already on)
};

// Candidates aggregated across several selected shifts (bulk assignment). Reuses
// candidatesForShift per order, then folds each worker's per-shift status into
// counts. A worker only appears if they qualify for at least one selected shift
// and aren't already assigned to all of them. Since a worker has a single
// qualification, they only surface for the selected shifts of that qualification.
export async function candidatesForOrders(orderIds: string[]): Promise<{
  shifts: BulkShift[];
  candidates: BulkCandidate[];
}> {
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
    },
  });
  if (orders.length === 0) return { shifts: [], candidates: [] };

  const perOrder = await Promise.all(orders.map((o) => candidatesForShift(o)));

  const map = new Map<string, BulkCandidate>();
  orders.forEach((o, i) => {
    for (const cand of perOrder[i]) {
      let agg = map.get(cand.workerId);
      if (!agg) {
        agg = {
          workerId: cand.workerId,
          fullName: cand.fullName,
          email: cand.email,
          qualification: o.requiredQualification,
          availableCount: 0,
          busyCount: 0,
          unavailableCount: 0,
          eligibleOrderIds: [],
        };
        map.set(cand.workerId, agg);
      }
      agg.eligibleOrderIds.push(o.id);
      if (cand.status === "available") agg.availableCount += 1;
      else if (cand.status === "busy") agg.busyCount += 1;
      else agg.unavailableCount += 1;
    }
  });

  const shifts: BulkShift[] = orders.map((o) => ({
    id: o.id,
    label: `${formatDateDE(o.shiftDate)} · ${o.startTime}–${o.endTime}`,
    requiredQualification: o.requiredQualification,
  }));

  const candidates = Array.from(map.values()).sort(
    (a, b) => b.availableCount - a.availableCount || a.fullName.localeCompare(b.fullName),
  );
  return { shifts, candidates };
}
