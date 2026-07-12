import { format } from "date-fns";
import { de } from "date-fns/locale";
import { resolveWorkerRates, resolveSurcharges, resolveNightWindow, rateFor, shiftSurchargeHours } from "@/lib/pricing";
import { germanHolidays } from "@/lib/holidays";
import { qualLabel } from "@/lib/invoicing";
import type { PayrollPdfData } from "@/lib/pdf/payroll";
import type { Qualification } from "@prisma/client";
import type { WorkerScheduleRow } from "@/lib/worker-schedule";

const formatNumber = (num: number) => num.toFixed(2).replace(".", ",");
const formatAmount = (num: number) => `${formatNumber(num)} €`;

import type { Worker } from "@prisma/client";

export function buildPayrollPdfData(
  worker: Pick<Worker, "id" | "fullName" | "address" | "hourlyRates" | "surchargeSat" | "surchargeSun" | "surchargeHoliday" | "surchargeNight" | "nightStart" | "nightEnd" | "qualification">,
  assignments: WorkerScheduleRow[],
  year: number,
  month: number
): PayrollPdfData {
  // Use worker's specific rates and surcharges
  const rates = resolveWorkerRates(worker);
  const surcharges = resolveSurcharges(worker);
  const nightWindow = resolveNightWindow(worker);

  // We use the worker's primary qualification for their base rate
  const baseRate = rateFor(worker.qualification, rates);

  const getHolidays = (y: number) => Array.from(germanHolidays(y).keys());
  const isHoliday = (dateStr: string) => getHolidays(parseInt(dateStr.slice(0, 4), 10)).includes(dateStr);

  let totalBaseHours = 0;
  let totalBonusHours = 0;
  let satHours = 0;
  let sunHours = 0;
  let nightHours = 0;
  let holidayHours = 0;
  let totalTravelCost = 0;
  let totalMealAllowance = 0;
  const uniqueDatesWithMeal = new Set<string>();

  for (const a of assignments) {
    const effectiveHours = a.confirmedHours != null ? a.confirmedHours : (a.scheduledHours ?? 0);
    if (effectiveHours === 0) continue;
    
    const shiftBonus = a.bonusHours || 0;
    const shiftBase = Math.max(0, effectiveHours - shiftBonus);
    
    totalBaseHours += shiftBase;
    totalBonusHours += shiftBonus;

    if (a.travelCost) {
      totalTravelCost += a.travelCost;
    }
    if (a.mealAllowance && !uniqueDatesWithMeal.has(a.date)) {
      uniqueDatesWithMeal.add(a.date);
      totalMealAllowance += a.mealAllowance;
    }

    // But wait, do we have breakMinutes in the query?
    // Let's check `lib/payroll-pdf-builder.ts`
    const breakMinutes = a.breakMinutes;
    const split = shiftSurchargeHours(a.date, a.startTime, a.endTime, breakMinutes, isHoliday, nightWindow);
    
    for (const chunk of split.values()) {
      if (chunk.components.includes("sat")) satHours += chunk.hours;
      if (chunk.components.includes("sun")) sunHours += chunk.hours;
      if (chunk.components.includes("holiday")) holidayHours += chunk.hours;
      if (chunk.components.includes("night")) nightHours += chunk.hours;
    }
  }

  let pos = 1;
  const items: PayrollPdfData["items"] = [];

  // 1. Base Hours
  if (totalBaseHours > 0) {
    items.push({
      pos: pos++,
      description: `Grundstunden (${qualLabel[worker.qualification]})`,
      hours: formatNumber(totalBaseHours),
      rate: formatAmount(baseRate),
      amount: formatAmount(totalBaseHours * baseRate),
    });
  }

  // 2. Bonus Hours
  if (totalBonusHours > 0) {
    items.push({
      pos: pos++,
      description: "Bonusstunden (Zusätzlich vereinbart)",
      hours: formatNumber(totalBonusHours),
      rate: formatAmount(baseRate),
      amount: formatAmount(totalBonusHours * baseRate),
    });
  }

  // 3. Surcharges
  if (holidayHours > 0 && surcharges.holiday > 0) {
    const rate = baseRate * surcharges.holiday;
    items.push({
      pos: pos++,
      description: `Feiertagszuschlag (${formatNumber(surcharges.holiday * 100)}%)`,
      hours: formatNumber(holidayHours),
      rate: formatAmount(rate),
      amount: formatAmount(holidayHours * rate),
    });
  }
  if (sunHours > 0 && surcharges.sun > 0) {
    const rate = baseRate * surcharges.sun;
    items.push({
      pos: pos++,
      description: `Sonntagszuschlag (${formatNumber(surcharges.sun * 100)}%)`,
      hours: formatNumber(sunHours),
      rate: formatAmount(rate),
      amount: formatAmount(sunHours * rate),
    });
  }
  if (satHours > 0 && surcharges.sat > 0) {
    const rate = baseRate * surcharges.sat;
    items.push({
      pos: pos++,
      description: `Samstagszuschlag (${formatNumber(surcharges.sat * 100)}%)`,
      hours: formatNumber(satHours),
      rate: formatAmount(rate),
      amount: formatAmount(satHours * rate),
    });
  }
  if (nightHours > 0 && surcharges.night > 0) {
    const rate = baseRate * surcharges.night;
    items.push({
      pos: pos++,
      description: `Nachtzuschlag (${formatNumber(surcharges.night * 100)}%)`,
      hours: formatNumber(nightHours),
      rate: formatAmount(rate),
      amount: formatAmount(nightHours * rate),
    });
  }

  // Allowances (Travel & Meal) - these are usually flat amounts without "hours" or "rate" in the same sense
  if (totalTravelCost > 0) {
    items.push({
      pos: pos++,
      description: "Fahrtkostenzuschuss (steuerfrei)",
      hours: "",
      rate: "",
      amount: formatAmount(totalTravelCost),
    });
  }

  if (totalMealAllowance > 0) {
    items.push({
      pos: pos++,
      description: "Verpflegungsmehraufwand (steuerfrei)",
      hours: "",
      rate: "",
      amount: formatAmount(totalMealAllowance),
    });
  }

  // Calculate Subtotal (Payout)
  const totalPayout = items.reduce((sum, item) => {
    // Parse the amount back to number to sum it up
    const amountVal = parseFloat(item.amount.replace(" €", "").replace(".", "").replace(",", "."));
    return sum + amountVal;
  }, 0);

  const monthStr = month.toString().padStart(2, "0");
  const monthName = format(new Date(year, month - 1, 1), "MMMM yyyy", { locale: de });

  return {
    documentTitle: `Abrechnung ${monthStr}/${year}`,
    date: format(new Date(), "dd.MM.yyyy"),
    workerId: worker.id,
    workerName: worker.fullName,
    workerAddress: worker.address || "",
    period: monthName,
    items,
    total: formatAmount(totalPayout),
  };
}
