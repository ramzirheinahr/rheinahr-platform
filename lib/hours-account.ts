import { prisma } from "@/lib/prisma";

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
    select: { 
      requiredHours: true, 
      carryoverHours: true,
      employmentStartDate: true,
      createdAt: true
    },
  });

  if (!worker) throw new Error("Worker not found");

  // Determine the actual start month to calculate from
  // If employmentStartDate exists, use it. Otherwise use createdAt.
  const startDate = worker.employmentStartDate || worker.createdAt;
  const startYearMonth = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}`;
  
  // We need to calculate all months from startYearMonth up to endMonth
  const actualStartMonth = startYearMonth < startMonth ? startYearMonth : startMonth;
  
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
      status: { notIn: ["declined"] },
      serviceConfirmation: { isNot: null },
      order: {
        shiftDate: {
          gte: startD,
          lt: new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() + 1, 1)),
        },
      },
    },
    select: {
      bonusHours: true,
      order: { select: { shiftDate: true } },
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
      return sum + (Number(a.serviceConfirmation?.hoursWorked || 0) + (a.bonusHours || 0));
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

    // Required hours could be adjusted in future, but currently we use base
    const requiredHours = baseRequiredHours;

    const monthBalance = (workedHours + vacationHours + sickHours + kAusgleichHours + sonstigeHours) - requiredHours;
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
