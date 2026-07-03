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
};

export type WorkerScheduleTotals = {
  confirmedHours: number;
  confirmedShifts: number;
};

export async function getWorkerMonthSchedule(
  workerId: string,
  year: number,
  month: number,
): Promise<{ rows: WorkerScheduleRow[]; totals: WorkerScheduleTotals }> {
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
  }));

  const confirmed = rows.filter((r) => r.confirmedHours != null);
  return {
    rows,
    totals: {
      confirmedHours: confirmed.reduce((sum, r) => sum + (r.confirmedHours ?? 0), 0),
      confirmedShifts: confirmed.length,
    },
  };
}
