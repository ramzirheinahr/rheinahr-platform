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
  // If employmentStartDate exists, use it. Otherwise use createdAt.
  const startDate = worker.employmentStartDate || worker.createdAt;
  const startYearMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  
  // We need to calculate all months from startYearMonth up to endMonth
  let actualStartMonth = startYearMonth < startMonth ? startYearMonth : startMonth;
  
  // Enforce global app start date of 2026-07
  if (actualStartMonth < "2026-07") {
    actualStartMonth = "2026-07";
  }
  
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

    // Required hours dynamic based on history
    const requiredHours = getEffectiveSollHours(monthStr, baseRequiredHours, worker.sollHoursHistory);

    const monthBalance = (workedHours + vacationHours + sickHours + sonstigeHours) - (requiredHours + kAusgleichHours);
    cumulativeBalance += monthBalance;

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
    initialCarryover = result[0].cumulativeBalance - result[0].monthBalance;
  } else {
    initialCarryover = cumulativeBalance; // if nothing is returned, the cumulative is the carryover
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

  // Calculate start and end dates globally for the query
  // We'll take the earliest employment start date among all workers
  let earliestStartDate = new Date();
  for (const w of workers) {
    const d = w.employmentStartDate || w.createdAt;
    if (d < earliestStartDate) earliestStartDate = d;
  }
  
  const startYearMonth = `${earliestStartDate.getFullYear()}-${String(earliestStartDate.getMonth() + 1).padStart(2, "0")}`;
  let actualStartMonth = startYearMonth < startMonth ? startYearMonth : startMonth;
  if (actualStartMonth < "2026-07") {
    actualStartMonth = "2026-07";
  }

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

    // determine this worker's individual start month
    const wStartDate = worker.employmentStartDate || worker.createdAt;
    const wStartYearMonth = `${wStartDate.getFullYear()}-${String(wStartDate.getMonth() + 1).padStart(2, "0")}`;
    let wActualStartMonth = wStartYearMonth < startMonth ? wStartYearMonth : startMonth;
    if (wActualStartMonth < "2026-07") wActualStartMonth = "2026-07";

    for (const monthStr of monthsToProcess) {
      if (monthStr < wActualStartMonth) continue; // Skip months before worker joined

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

      const requiredHours = getEffectiveSollHours(monthStr, baseRequiredHours, worker.sollHoursHistory);
      const monthBalance = (workedHours + vacationHours + sickHours + sonstigeHours) - (requiredHours + kAusgleichHours);
      cumulativeBalance += monthBalance;

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
      initialCarryover = workerMonths[0].cumulativeBalance - workerMonths[0].monthBalance;
    } else {
      initialCarryover = cumulativeBalance;
    }

    resultByWorker[workerId] = { months: workerMonths, initialCarryover };
  }

  return resultByWorker;
}
