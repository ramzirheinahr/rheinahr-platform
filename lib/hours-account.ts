import { prisma } from "@/lib/prisma";
import { getEffectiveSollHours } from "./worker-soll-hours";
export type MonthlyHoursAccount = {
  month: string; // YYYY-MM
  requiredHours: number; // Soll
  workedHours: number; // Ist
  vacationHours: number; // Urlaub
  sickHours: number; // Krank
  kAusgleichHours: number; // K.Ausgleich
  sonstigeHours: number; // Sonstige
  monthBalance: number; // Summe
  cumulativeBalance: number; // Cumulative Sum
};

function toYearMonth(d: Date | null | undefined): string | null {
  if (!d || isNaN(d.getTime())) return null;
  let y = d.getFullYear();
  if (y < 100) y += 2000;
  if (y > 2100) y = 2024;
  return `${String(y).padStart(4, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getWorkerHoursAccount(
  workerId: string,
  startMonth: string, // YYYY-MM
  endMonth: string, // YYYY-MM
): Promise<{ months: MonthlyHoursAccount[], initialCarryover: number }> {
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    include: {
      sollHoursHistory: true,
    },
  });

  if (!worker) throw new Error("Worker not found");

  // Determine the actual start month to calculate from
  // If employmentStartDate or employedSince exists, use it. Otherwise use createdAt.
  const startDate = worker.employmentStartDate || worker.employedSince || worker.createdAt;
  const startYearMonth = toYearMonth(startDate) || "2026-07";
  const endDate = worker.employmentEndDate;
  const endYearMonth = toYearMonth(endDate);
  
  // Calculate months starting from 2026-07 (when shift tracking began), but not after startMonth
  const actualStartMonth = startMonth < "2026-07" ? startMonth : "2026-07";
  
  const startD = new Date(`${actualStartMonth}-01T00:00:00Z`);
  const endD = new Date(`${endMonth}-01T00:00:00Z`);
  
  // Create an array of months to process
  const monthsToProcess: string[] = [];
  let currentD = new Date(startD);
  while (currentD <= endD) {
    monthsToProcess.push(`${currentD.getUTCFullYear()}-${String(currentD.getUTCMonth() + 1).padStart(2, "0")}`);
    currentD.setUTCMonth(currentD.getUTCMonth() + 1);
  }

  // Fetch all relevant assignments
  const assignments = await prisma.assignment.findMany({
    where: {
      workerId,
      status: "confirmed",
      order: {
        shiftDate: {
          gte: startD,
          lt: new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() + 1, 1)),
        },
      },
    },
    select: {
      bonusHours: true,
      order: { select: { shiftDate: true, startTime: true, endTime: true, breakMinutes: true } },
      serviceConfirmation: { select: { hoursWorked: true } },
    },
  });

  // Fetch leave days
  const leaveDays = await prisma.leaveDay.findMany({
    where: {
      leaveRequest: { workerId },
      status: "approved",
      date: {
        gte: startD,
        lt: new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() + 1, 1)),
      },
    },
    select: {
      date: true,
      hours: true,
      leaveRequest: { select: { type: true } },
    },
  });

  // Fetch adjustments
  const adjustments = await prisma.workerHoursAdjustment.findMany({
    where: {
      workerId,
      month: { in: monthsToProcess }
    },
  });

  const baseRequiredHours = worker.requiredHours ?? 151.67;

  let cumulativeBalance = worker.carryoverHours || 0;
  const result: MonthlyHoursAccount[] = [];

  for (const monthStr of monthsToProcess) {
    // Skip processing or adding months if worker hasn't joined yet or already left
    const isEmployedInMonth = monthStr >= startYearMonth && (!endYearMonth || monthStr <= endYearMonth);
    if (!isEmployedInMonth) continue;

    // worked hours
    const monthAssignments = assignments.filter(a => {
      const d = a.order.shiftDate;
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthStr;
    });
    const workedHours = monthAssignments.reduce((sum, a) => {
      let hours = 0;
      if (a.serviceConfirmation?.hoursWorked != null) {
        hours = Number(a.serviceConfirmation.hoursWorked);
      } else {
        const st = new Date(`1970-01-01T${a.order.startTime}Z`).getTime();
        const et = new Date(`1970-01-01T${a.order.endTime}Z`).getTime();
        let diffMins = (et - st) / 60000;
        if (diffMins < 0) diffMins += 24 * 60;
        const netMins = diffMins - (a.order.breakMinutes || 0);
        hours = netMins / 60;
      }
      return sum + hours + (a.bonusHours || 0);
    }, 0);

    // leave hours
    const monthLeaves = leaveDays.filter(l => {
      const d = l.date;
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthStr;
    });
    const vacationHours = monthLeaves.filter(l => l.leaveRequest.type === "vacation").reduce((sum, l) => sum + l.hours, 0);
    const sickHours = monthLeaves.filter(l => l.leaveRequest.type === "sick").reduce((sum, l) => sum + l.hours, 0);
    const otherLeaveHours = monthLeaves.filter(l => l.leaveRequest.type === "other").reduce((sum, l) => sum + l.hours, 0);

    // adjustments
    const monthAdjustments = adjustments.filter(a => a.month === monthStr);
    const kAusgleichHours = monthAdjustments.filter(a => a.type === "k_ausgleich").reduce((sum, a) => sum + a.hours, 0);
    const sonstigeHours = monthAdjustments.filter(a => a.type === "sonstige").reduce((sum, a) => sum + a.hours, 0) + otherLeaveHours; // Add other leaves to sonstige

    // Required hours dynamic based on history and contract dates
    const requiredHours = getEffectiveSollHours(
      monthStr,
      baseRequiredHours,
      worker.sollHoursHistory,
      {
        employmentStartDate: worker.employmentStartDate,
        employmentEndDate: worker.employmentEndDate,
        employedSince: worker.employedSince,
        monthlySalary: worker.monthlySalary,
      }
    );

    const monthBalance = Math.round(((workedHours + vacationHours + sickHours + sonstigeHours) - (requiredHours + kAusgleichHours)) * 100) / 100;
    cumulativeBalance = Math.round((cumulativeBalance + monthBalance) * 100) / 100;

    if (monthStr >= startMonth) {
      result.push({
        month: monthStr,
        requiredHours,
        workedHours,
        vacationHours,
        sickHours,
        kAusgleichHours,
        sonstigeHours,
        monthBalance,
        cumulativeBalance,
      });
    }
  }

  let initialCarryover = worker.carryoverHours || 0;
  if (result.length > 0) {
    initialCarryover = Math.round((result[0].cumulativeBalance - result[0].monthBalance) * 100) / 100;
  } else {
    initialCarryover = Math.round(cumulativeBalance * 100) / 100;
  }

  return { months: result, initialCarryover };
}

export async function getMultipleWorkersHoursAccount(
  workerIds: string[],
  startMonth: string, // YYYY-MM
  endMonth: string, // YYYY-MM
): Promise<Record<string, { months: MonthlyHoursAccount[], initialCarryover: number }>> {
  if (workerIds.length === 0) return {};

  const workers = await prisma.worker.findMany({
    where: { id: { in: workerIds } },
    include: {
      sollHoursHistory: true,
    },
  });

  // The system hour tracking began globally in 2026-07.
  // Any historical hours prior to 2026-07 are stored in worker.carryoverHours.
  // To compute the correct carryover (Stand Alt) into startMonth, we must process
  // all months starting from 2026-07 (or startMonth if earlier) up to endMonth.
  const actualStartMonth = startMonth < "2026-07" ? startMonth : "2026-07";

  const startD = new Date(`${actualStartMonth}-01T00:00:00Z`);
  const endD = new Date(`${endMonth}-01T00:00:00Z`);
  
  const monthsToProcess: string[] = [];
  let currentD = new Date(startD);
  while (currentD <= endD) {
    monthsToProcess.push(`${currentD.getUTCFullYear()}-${String(currentD.getUTCMonth() + 1).padStart(2, "0")}`);
    currentD.setUTCMonth(currentD.getUTCMonth() + 1);
  }

  const queryEndD = new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() + 1, 1));

  const [allAssignments, allLeaves, allAdjustments] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        workerId: { in: workerIds },
        status: "confirmed",
        order: { shiftDate: { gte: startD, lt: queryEndD } },
      },
      select: {
        workerId: true,
        bonusHours: true,
        order: { select: { shiftDate: true, startTime: true, endTime: true, breakMinutes: true } },
        serviceConfirmation: { select: { hoursWorked: true } },
      },
    }),
    prisma.leaveDay.findMany({
      where: {
        leaveRequest: { workerId: { in: workerIds } },
        status: "approved",
        date: { gte: startD, lt: queryEndD },
      },
      select: {
        date: true,
        hours: true,
        leaveRequest: { select: { workerId: true, type: true } },
      },
    }),
    prisma.workerHoursAdjustment.findMany({
      where: {
        workerId: { in: workerIds },
        month: { in: monthsToProcess }
      },
    })
  ]);

  const resultByWorker: Record<string, { months: MonthlyHoursAccount[], initialCarryover: number }> = {};

  for (const worker of workers) {
    const workerId = worker.id;
    const baseRequiredHours = worker.requiredHours ?? 151.67;
    let cumulativeBalance = worker.carryoverHours || 0;
    const workerMonths: MonthlyHoursAccount[] = [];

    const assignments = allAssignments.filter(a => a.workerId === workerId);
    const leaveDays = allLeaves.filter(l => l.leaveRequest.workerId === workerId);
    const adjustments = allAdjustments.filter(a => a.workerId === workerId);

    // determine this worker's individual start month and end month
    const wStartDate = worker.employmentStartDate || worker.employedSince || worker.createdAt;
    const wStartYearMonth = toYearMonth(wStartDate) || "2026-07";
    const wEndDate = worker.employmentEndDate;
    const wEndYearMonth = toYearMonth(wEndDate);

    for (const monthStr of monthsToProcess) {
      if (monthStr < wStartYearMonth) continue; // Skip months before worker joined
      if (wEndYearMonth && monthStr > wEndYearMonth) continue; // Skip months after worker left

      const monthAssignments = assignments.filter(a => {
        const d = a.order.shiftDate;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthStr;
      });
      const workedHours = monthAssignments.reduce((sum, a) => {
        let hours = 0;
        if (a.serviceConfirmation?.hoursWorked != null) {
          hours = Number(a.serviceConfirmation.hoursWorked);
        } else {
          const st = new Date(`1970-01-01T${a.order.startTime}Z`).getTime();
          const et = new Date(`1970-01-01T${a.order.endTime}Z`).getTime();
          let diffMins = (et - st) / 60000;
          if (diffMins < 0) diffMins += 24 * 60;
          const netMins = diffMins - (a.order.breakMinutes || 0);
          hours = netMins / 60;
        }
        return sum + hours + (a.bonusHours || 0);
      }, 0);

      const monthLeaves = leaveDays.filter(l => {
        const d = l.date;
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthStr;
      });
      const vacationHours = monthLeaves.filter(l => l.leaveRequest.type === "vacation").reduce((sum, l) => sum + l.hours, 0);
      const sickHours = monthLeaves.filter(l => l.leaveRequest.type === "sick").reduce((sum, l) => sum + l.hours, 0);
      const otherLeaveHours = monthLeaves.filter(l => l.leaveRequest.type === "other").reduce((sum, l) => sum + l.hours, 0);

      const monthAdjustments = adjustments.filter(a => a.month === monthStr);
      const kAusgleichHours = monthAdjustments.filter(a => a.type === "k_ausgleich").reduce((sum, a) => sum + a.hours, 0);
      const sonstigeHours = monthAdjustments.filter(a => a.type === "sonstige").reduce((sum, a) => sum + a.hours, 0) + otherLeaveHours;

      const requiredHours = getEffectiveSollHours(
        monthStr,
        baseRequiredHours,
        worker.sollHoursHistory,
        {
          employmentStartDate: worker.employmentStartDate,
          employmentEndDate: worker.employmentEndDate,
          employedSince: worker.employedSince,
          monthlySalary: worker.monthlySalary,
        }
      );
      const monthBalance = Math.round(((workedHours + vacationHours + sickHours + sonstigeHours) - (requiredHours + kAusgleichHours)) * 100) / 100;
      cumulativeBalance = Math.round((cumulativeBalance + monthBalance) * 100) / 100;

      if (monthStr >= startMonth) {
        workerMonths.push({
          month: monthStr,
          requiredHours,
          workedHours,
          vacationHours,
          sickHours,
          kAusgleichHours,
          sonstigeHours,
          monthBalance,
          cumulativeBalance,
        });
      }
    }

    let initialCarryover = worker.carryoverHours || 0;
    if (workerMonths.length > 0) {
      initialCarryover = Math.round((workerMonths[0].cumulativeBalance - workerMonths[0].monthBalance) * 100) / 100;
    } else {
      initialCarryover = Math.round(cumulativeBalance * 100) / 100;
    }

    resultByWorker[workerId] = { months: workerMonths, initialCarryover };
  }

  return resultByWorker;
}
