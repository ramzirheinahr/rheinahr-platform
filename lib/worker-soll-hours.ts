export interface WorkerSollHoursRecord {
  validFrom: string; // "YYYY-MM"
  monthlyHours: number;
}

export interface WorkerEmploymentDetails {
  employmentStartDate?: Date | string | null;
  employmentEndDate?: Date | string | null;
  employedSince?: Date | string | null;
  monthlySalary?: number | null;
}

export interface MonthlySollResult {
  requiredHours: number;
  isPartialMonth: boolean;
  activeDays: number;
  totalDaysInMonth: number;
  hourlyRate: number | null;
  dailyRate: number | null;
  partialSalary: number | null;
  isEmployedInMonth: boolean;
}

function toDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * Calculates the monthly required hours (Soll-Stunden) considering:
 * 1. Soll-Stunden history (validFrom).
 * 2. Employment start date (employmentStartDate || employedSince).
 * 3. Employment end date (employmentEndDate).
 * 4. 4-step proportional calculation for partial months (30-day divisor method):
 *    - Step 1: Hourly rate = Monatsgehalt / baseRequiredHours
 *    - Step 2: Daily rate = Monatsgehalt / 30
 *    - Step 3: Partial salary = Daily rate * activeDays
 *    - Step 4: Partial required hours = Partial salary / Hourly rate
 */
export function calculateWorkerMonthlySoll(
  targetMonthStr: string, // "YYYY-MM"
  baseRequiredHours: number,
  history?: WorkerSollHoursRecord[],
  details?: WorkerEmploymentDetails
): MonthlySollResult {
  // Determine base required hours for this month from history or fallback
  let baseHours = baseRequiredHours;
  if (history && history.length > 0) {
    const sorted = [...history].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
    const active = sorted.find((h) => h.validFrom <= targetMonthStr);
    if (active) {
      baseHours = active.monthlyHours;
    }
  }

  // If no employment details provided, return standard full month hours
  if (!details) {
    return {
      requiredHours: baseHours,
      isPartialMonth: false,
      activeDays: 0,
      totalDaysInMonth: 0,
      hourlyRate: null,
      dailyRate: null,
      partialSalary: null,
      isEmployedInMonth: true,
    };
  }

  const [yearStr, mStr] = targetMonthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(mStr, 10);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStartStr = `${targetMonthStr}-01`;
  const monthEndStr = `${targetMonthStr}-${String(daysInMonth).padStart(2, "0")}`;

  const startDateStr = toDateStr(details.employmentStartDate || details.employedSince);
  const endDateStr = toDateStr(details.employmentEndDate);

  // Case 1: Worker has not joined yet (employment starts after this month ends)
  if (startDateStr && startDateStr > monthEndStr) {
    return {
      requiredHours: 0,
      isPartialMonth: false,
      activeDays: 0,
      totalDaysInMonth: daysInMonth,
      hourlyRate: null,
      dailyRate: null,
      partialSalary: 0,
      isEmployedInMonth: false,
    };
  }

  // Case 2: Worker has already left (employment ended before this month started)
  if (endDateStr && endDateStr < monthStartStr) {
    return {
      requiredHours: 0,
      isPartialMonth: false,
      activeDays: 0,
      totalDaysInMonth: daysInMonth,
      hourlyRate: null,
      dailyRate: null,
      partialSalary: 0,
      isEmployedInMonth: false,
    };
  }

  // Determine active start and end days within this month
  let startDay = 1;
  if (startDateStr && startDateStr > monthStartStr && startDateStr <= monthEndStr) {
    startDay = parseInt(startDateStr.slice(8, 10), 10);
  }

  let endDay = daysInMonth;
  if (endDateStr && endDateStr >= monthStartStr && endDateStr < monthEndStr) {
    endDay = parseInt(endDateStr.slice(8, 10), 10);
  }

  // Case 3: Full month employed (starts on or before day 1, ends on or after last day)
  if (startDay === 1 && endDay === daysInMonth) {
    return {
      requiredHours: baseHours,
      isPartialMonth: false,
      activeDays: daysInMonth,
      totalDaysInMonth: daysInMonth,
      hourlyRate: details.monthlySalary && baseHours > 0
        ? Math.round((details.monthlySalary / baseHours) * 100) / 100
        : null,
      dailyRate: details.monthlySalary
        ? Math.round((details.monthlySalary / 30) * 100) / 100
        : null,
      partialSalary: details.monthlySalary ?? null,
      isEmployedInMonth: true,
    };
  }

  // Case 4: Partial month (started mid-month or left mid-month)
  const activeDays = Math.max(0, endDay - startDay + 1);
  if (activeDays === 0) {
    return {
      requiredHours: 0,
      isPartialMonth: true,
      activeDays: 0,
      totalDaysInMonth: daysInMonth,
      hourlyRate: null,
      dailyRate: null,
      partialSalary: 0,
      isEmployedInMonth: true,
    };
  }

  const salary = details.monthlySalary;
  if (salary && salary > 0 && baseHours > 0) {
    // Unrounded intermediate steps: precision is preserved throughout all steps
    // Step 1: Hourly rate (raw)
    const rawHourlyRate = salary / baseHours;
    // Step 2: Daily rate (raw)
    const rawDailyRate = salary / 30;
    // Step 3: Partial month salary (raw)
    const rawPartialSalary = (salary * activeDays) / 30;
    // Step 4: Partial required hours (raw)
    const rawRequiredHours = rawHourlyRate > 0
      ? rawPartialSalary / rawHourlyRate
      : (activeDays / 30) * baseHours;

    // Rounding is ONLY applied in the final step to 2 decimal places:
    const requiredHours = Math.round(rawRequiredHours * 100) / 100;
    const hourlyRate = Math.round(rawHourlyRate * 100) / 100;
    const dailyRate = Math.round(rawDailyRate * 100) / 100;
    const partialSalary = Math.round(rawPartialSalary * 100) / 100;

    return {
      requiredHours,
      isPartialMonth: true,
      activeDays,
      totalDaysInMonth: daysInMonth,
      hourlyRate,
      dailyRate,
      partialSalary,
      isEmployedInMonth: true,
    };
  } else {
    // Fallback if no monthly salary is set: proportional using 30-day divisor
    const requiredHours = Math.round(((activeDays / 30) * baseHours) * 100) / 100;
    return {
      requiredHours,
      isPartialMonth: true,
      activeDays,
      totalDaysInMonth: daysInMonth,
      hourlyRate: null,
      dailyRate: null,
      partialSalary: null,
      isEmployedInMonth: true,
    };
  }
}

/**
 * Returns the effective monthly required hours (Soll-Stunden) for a given month.
 * Automatically accounts for:
 * - History entries (validFrom).
 * - Partial months (mid-month start / departure).
 * - Departure in previous months (returns 0).
 */
export function getEffectiveSollHours(
  targetMonthStr: string, // "YYYY-MM"
  baseRequiredHours: number,
  history?: WorkerSollHoursRecord[],
  details?: WorkerEmploymentDetails
): number {
  return calculateWorkerMonthlySoll(targetMonthStr, baseRequiredHours, history, details).requiredHours;
}
