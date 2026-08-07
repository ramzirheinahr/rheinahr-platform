import { format } from "@/lib/date-utils";
import { resolveRates, resolveSurcharges, resolveNightWindow, rateFor, shiftSurchargeHours } from "@/lib/pricing";
import { germanHolidays } from "@/lib/holidays";
import { qualLabel } from "@/lib/invoicing";
import { buildAddressString } from "@/lib/utils";
import type { InvoicePdfData } from "@/lib/pdf/invoice";
import type { Qualification } from "@/lib/validations";

const formatNumber = (num: number) => num.toFixed(2).replace(".", ",");
const formatAmount = (num: number) => `${formatNumber(num)} €`;

import type { Invoice, Client, Assignment, Order, Worker } from "@prisma/client";

export function buildInvoicePdfData(
  invoice: Pick<Invoice, "invoiceNumber" | "date" | "netAmount" | "vatAmount" | "grossAmount">,
  client: Pick<Client, "id" | "shortCode" | "internalNumber" | "facilityName" | "address" | "billingInfo" | "hourlyRates" | "surchargeSat" | "surchargeSun" | "surchargeHoliday" | "surchargeNight" | "nightStart" | "nightEnd" | "paymentTermsDays">,
  assignments: (Pick<Assignment, "id"> & { order: Pick<Order, "requiredQualification" | "shiftDate" | "startTime" | "endTime" | "breakMinutes">, worker: Pick<Worker, "fullName"> })[]
): InvoicePdfData {
  const rates = resolveRates(client);
  const surcharges = resolveSurcharges(client);
  const nightWindow = resolveNightWindow(client);

  const getHolidays = (year: number) => Array.from(germanHolidays(year).keys());
  const isHoliday = (dateStr: string) => getHolidays(parseInt(dateStr.slice(0, 4), 10)).includes(dateStr);

  type GroupData = {
    baseHours: number;
    satHours: number;
    sunHours: number;
    nightHours: number;
    holidayHours: number;
    assignments: (Pick<Assignment, "id"> & { order: Pick<Order, "requiredQualification" | "shiftDate" | "startTime" | "endTime" | "breakMinutes">, worker: Pick<Worker, "fullName"> })[];
    workerName: string;
    qual: Qualification;
  };

  const grouped = new Map<string, GroupData>();

  for (const a of assignments) {
    const qual = a.order.requiredQualification as Qualification;
    const workerName = a.worker.fullName;
    const key = `${workerName}-${qual}`;
    
    let group = grouped.get(key);
    if (!group) {
      group = { baseHours: 0, satHours: 0, sunHours: 0, nightHours: 0, holidayHours: 0, assignments: [], workerName, qual };
      grouped.set(key, group);
    }
    group.assignments.push(a);

    const shiftDateStr = a.order.shiftDate.toISOString().slice(0, 10);
    const split = shiftSurchargeHours(shiftDateStr, a.order.startTime, a.order.endTime, a.order.breakMinutes ?? 30, isHoliday, nightWindow);
    
    for (const chunk of split.values()) {
      group.baseHours += chunk.hours;
      if (chunk.components.includes("sat")) group.satHours += chunk.hours;
      if (chunk.components.includes("sun")) group.sunHours += chunk.hours;
      if (chunk.components.includes("holiday")) group.holidayHours += chunk.hours;
      if (chunk.components.includes("night")) group.nightHours += chunk.hours;
    }
  }

  let pos = 1;
  const items: InvoicePdfData["items"] = [];

  for (const [key, group] of grouped.entries()) {
    const baseRate = rateFor(group.qual, rates);
    const qName = qualLabel[group.qual] || group.qual;
    const wName = group.workerName;

    if (group.baseHours > 0) {
      const sorted = [...group.assignments].sort((a, b) => a.order.shiftDate.getTime() - b.order.shiftDate.getTime());
      const startStr = sorted[0] ? format(sorted[0].order.shiftDate, "dd.MM.yyyy") : "";
      const endStr = sorted[sorted.length - 1] ? format(sorted[sorted.length - 1].order.shiftDate, "dd.MM.yyyy") : "";
      items.push({ pos: pos++, description: `${wName} (${qName}) vom ${startStr} bis ${endStr}`, hours: formatNumber(group.baseHours), rate: formatNumber(baseRate), amount: formatAmount(group.baseHours * baseRate) });
    }
    if (group.satHours > 0) {
      const sRate = baseRate * surcharges.sat;
      items.push({ pos: pos++, description: `Samstagzuschlag (${wName}) ${surcharges.sat * 100}%`, hours: formatNumber(group.satHours), rate: formatNumber(sRate), amount: formatAmount(group.satHours * sRate) });
    }
    if (group.nightHours > 0) {
      const sRate = baseRate * surcharges.night;
      items.push({ pos: pos++, description: `Nachtzuschlag (${nightWindow.start}-${nightWindow.end}) (${wName}) ${surcharges.night * 100}%`, hours: formatNumber(group.nightHours), rate: formatNumber(sRate), amount: formatAmount(group.nightHours * sRate) });
    }
    if (group.sunHours > 0) {
      const sRate = baseRate * surcharges.sun;
      items.push({ pos: pos++, description: `Sonntagzuschlag (${wName}) ${surcharges.sun * 100}%`, hours: formatNumber(group.sunHours), rate: formatNumber(sRate), amount: formatAmount(group.sunHours * sRate) });
    }
    if (group.holidayHours > 0) {
      const sRate = baseRate * surcharges.holiday;
      items.push({ pos: pos++, description: `Feiertagszuschlag (${wName}) ${surcharges.holiday * 100}%`, hours: formatNumber(group.holidayHours), rate: formatNumber(sRate), amount: formatAmount(group.holidayHours * sRate) });
    }
  }

  const allAssignments = [...assignments].sort((a, b) => a.order.shiftDate.getTime() - b.order.shiftDate.getTime());
  const periodStart = allAssignments[0] ? format(allAssignments[0].order.shiftDate, "dd.MM.yyyy") : "";
  const periodEnd = allAssignments[allAssignments.length - 1] ? format(allAssignments[allAssignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "";

  return {
    invoiceNumber: invoice.invoiceNumber,
    date: format(invoice.date || new Date(), "dd.MM.yyyy"),
    clientId: client.internalNumber || client.shortCode || client.id.substring(0, 8),
    clientName: client.facilityName,
    billingInfo: client.billingInfo || null,
    clientAddress: buildAddressString(client) || "Adresse unbekannt",
    periodStart,
    periodEnd,
    items,
    subtotal: formatAmount(invoice.netAmount),
    taxAmount: formatAmount(invoice.vatAmount),
    total: formatAmount(invoice.grossAmount),
    paymentTermsDays: client.paymentTermsDays,
  };
}
