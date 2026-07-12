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
  breakMinutes: number; // added to pass to payroll for surcharge split
  scheduledHours: number; // planned net hours (break deducted)
  confirmedHours: number | null; // client-confirmed net hours, null until signed
  cancelRequested: boolean; // worker asked the office to be taken off this shift
  cancelNote: string | null;
  distanceKm?: number | null; // one-way distance to the facility
  travelCost?: number | null; // allowance for this shift (both ways)
  mealAllowance?: number | null; // meal allowance for this shift
  addMealAllowance?: boolean; // exceptionally added meal allowance
  excludeMealAllowance?: boolean; // exceptionally excluded meal allowance
  excludeTravelAllowance?: boolean; // exceptionally excluded travel allowance
  bonusHours?: number; // bonus hours for this shift
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

import { getDrivingDistanceKm } from "@/lib/geocoding";

export async function getWorkerMonthSchedule(
  workerId: string,
  year: number,
  month: number,
): Promise<{ rows: WorkerScheduleRow[]; leaveDays: WorkerLeaveDay[]; totals: WorkerScheduleTotals }> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { requiredHours: true, carryoverHours: true, address: true, travelAllowanceEnabled: true, travelAllowancePerKm: true, mealAllowanceEnabled: true, mealAllowance: true },
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
            breakMinutes: true,
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

  const rows: WorkerScheduleRow[] = await Promise.all(
    assignments.map(async (a) => {
      let distanceKm: number | null = null;
      let travelCost: number | null = null;
      let mealAllowance: number | null = null;
      
      if (worker?.address && a.order.client.address) {
        distanceKm = await getDrivingDistanceKm(worker.address, a.order.client.address);
        if (distanceKm != null && worker?.travelAllowanceEnabled && !a.excludeTravelAllowance) {
          // Client request: one-way distance * rate
          const rate = worker.travelAllowancePerKm ?? 0.30;
          travelCost = distanceKm * rate;
        }
      }

      if (!a.excludeMealAllowance && (worker?.mealAllowanceEnabled || a.addMealAllowance)) {
        mealAllowance = worker?.mealAllowance ?? 14.0;
      }

      return {
        id: a.id,
        status: a.status,
        date: a.order.shiftDate.toISOString().slice(0, 10),
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        notes: a.order.notes,
        facilityName: a.order.client.facilityName,
        address: a.order.client.address,
        breakMinutes: a.order.breakMinutes ?? 30,
        scheduledHours: netShiftHours(
          a.order.startTime,
          a.order.endTime,
          a.order.breakMinutes ?? 30,
        ),
        confirmedHours:
          a.serviceConfirmation?.hoursWorked != null
            ? Number(a.serviceConfirmation.hoursWorked) + (a.bonusHours ?? 0)
            : null,
        cancelRequested: a.cancelRequested,
        cancelNote: a.cancelNote,
        distanceKm,
        travelCost,
        mealAllowance,
        addMealAllowance: a.addMealAllowance,
        excludeMealAllowance: a.excludeMealAllowance,
        excludeTravelAllowance: a.excludeTravelAllowance,
        bonusHours: a.bonusHours,
      };
    })
  );

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
        status: { in: ["available", "unavailable"] },
        date: {
          gte: new Date(Date.UTC(year, month - 1, 1)),
          lt: new Date(Date.UTC(year, month, 1)),
        },
      },
      select: { date: true, startTime: true, endTime: true, status: true },
    })
    .catch(() => []);
  return blocks.map((b) => ({
    date: b.date.toISOString().slice(0, 10),
    startTime: b.status === "unavailable" ? null : b.startTime,
    endTime: b.status === "unavailable" ? null : b.endTime,
    status: b.status,
  }));
}
