import { prisma } from "@/lib/prisma";
import { netShiftHours } from "@/lib/pricing";
import type { AssignmentStatus } from "@prisma/client";

// One month of a worker's assignments enriched with the client-side service
// confirmation. `confirmedHours` mirrors what the client signed off on the
// Leistungsnachweis — already net of the break (see netShiftHours), so it is
// the billable/payable figure. Shared by the worker schedule page and the
// admin per-worker hours page so both always show identical numbers.
export type WorkerScheduleRow = {
  id: string;
  status: AssignmentStatus;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  notes: string | null;
  facilityName: string;
  address: string | null;
  scheduledHours: number; // planned net hours (break deducted)
  confirmedHours: number | null; // client-confirmed net hours, null until signed
  cancelRequested: boolean; // worker asked the office to be taken off this shift
  cancelNote: string | null;
};

export type WorkerLeaveDay = {
  id: string;
  date: string;
  status: "pending" | "approved" | "rejected";
  hours: number;
};

export type WorkerScheduleTotals = {
  requiredHours: number;
  // Signed hours-account balance brought forward from earlier months (positive =
  // still owed, negative = worked-ahead credit). Added to requiredHours for the
  // month's total soll; the remaining (soll − confirmed) may go negative.
  carryoverHours: number;
  confirmedHours: number;
  confirmedShifts: number;
};

export async function getWorkerMonthSchedule(
  workerId: string,
  year: number,
  month: number,
): Promise<{ rows: WorkerScheduleRow[]; leaveDays: WorkerLeaveDay[]; totals: WorkerScheduleTotals }> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { requiredHours: true, carryoverHours: true },
  });
  
  const assignments = await prisma.assignment
    .findMany({
      where: {
        workerId,
        order: {
          shiftDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      },
      orderBy: [{ order: { shiftDate: "asc" } }, { order: { startTime: "asc" } }],
      include: {
        order: {
          select: {
            shiftDate: true,
            startTime: true,
            endTime: true,
            notes: true,
            client: { select: { facilityName: true, address: true } },
          },
        },
        serviceConfirmation: { select: { hoursWorked: true } },
      },
    })
    .catch(() => []);

  const leaveDaysData = await prisma.leaveDay.findMany({
    where: {
      leaveRequest: { workerId },
      date: {
        gte: new Date(Date.UTC(year, month - 1, 1)),
        lt: new Date(Date.UTC(year, month, 1)),
      },
    },
    select: {
      id: true,
      date: true,
      status: true,
      hours: true,
    },
  }).catch(() => []);

  const leaveDays: WorkerLeaveDay[] = leaveDaysData.map(ld => ({
    id: ld.id,
    date: ld.date.toISOString().slice(0, 10),
    status: ld.status,
    hours: ld.hours,
  }));

  const rows: WorkerScheduleRow[] = assignments.map((a) => ({
    id: a.id,
    status: a.status,
    date: a.order.shiftDate.toISOString().slice(0, 10),
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    notes: a.order.notes,
    facilityName: a.order.client.facilityName,
    address: a.order.client.address,
    scheduledHours: netShiftHours(a.order.startTime, a.order.endTime),
    confirmedHours:
      a.serviceConfirmation?.hoursWorked != null
        ? Number(a.serviceConfirmation.hoursWorked)
        : null,
    cancelRequested: a.cancelRequested,
    cancelNote: a.cancelNote,
  }));

  const confirmed = rows.filter((r) => r.confirmedHours != null);
  const approvedLeaves = leaveDays.filter((l) => l.status === "approved");
  
  return {
    rows,
    leaveDays,
    totals: {
      requiredHours: worker?.requiredHours ?? 151.67,
      carryoverHours: worker?.carryoverHours ?? 0,
      confirmedHours:
        confirmed.reduce((sum, r) => sum + (r.confirmedHours ?? 0), 0) +
        approvedLeaves.reduce((sum, l) => sum + l.hours, 0),
      confirmedShifts: confirmed.length + approvedLeaves.length,
    },
  };
}

// One month of positive availability blocks in the shape the
// AvailabilityBuilder expects — used by the worker's own schedule page and the
// admin mirror. Availability is opt-in: only declared windows are stored.
export async function getWorkerMonthAvailability(
  workerId: string,
  year: number,
  month: number,
): Promise<{ date: string; startTime: string | null; endTime: string | null }[]> {
  const blocks = await prisma.workerAvailability
    .findMany({
      where: {
        workerId,
        status: "available",
        date: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
      select: { date: true, startTime: true, endTime: true },
    })
    .catch(() => []);
  return blocks.map((b) => ({
    date: b.date.toISOString().slice(0, 10),
    startTime: b.startTime,
    endTime: b.endTime,
  }));
}
