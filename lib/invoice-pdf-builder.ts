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
  client: Pick<Client, "id" | "shortCode" | "internalNumber" | "facilityName" | "address" | "billingEmail" | "billingInfo" | "hourlyRates" | "surchargeSat" | "surchargeSun" | "surchargeHoliday" | "surchargeNight" | "nightStart" | "nightEnd" | "paymentTermsDays">,
  assignments: (Pick<Assignment, "id"> & { order: Pick<Order, "requiredQualification" | "shiftDate" | "startTime" | "endTime" | "breakMinutes">, worker: Pick<Worker, "fullName"> })[]
): InvoicePdfData {
  // If the invoice has a snapshot of the client data (prices, address, etc.), use it. 
  // Otherwise fallback to current live client data.
  const snapshot = (invoice as any).snapshotData || {};
  const effectiveClient = { ...client, ...snapshot } as typeof client;

  // If the invoice has an immutable frozen snapshot of the items, return them directly.
  if (Array.isArray(snapshot.items) && snapshot.items.length > 0) {
    return {
      invoiceNumber: invoice.invoiceNumber,
      date: snapshot.date || format(invoice.date || new Date(), "dd.MM.yyyy"),
      clientId: effectiveClient.internalNumber || effectiveClient.shortCode || effectiveClient.id.substring(0, 8),
      clientName: effectiveClient.facilityName,
      billingInfo: effectiveClient.billingInfo || null,
      clientAddress: buildAddressString(effectiveClient) || "Adresse unbekannt",
      periodStart: snapshot.periodStart || "",
      periodEnd: snapshot.periodEnd || "",
      items: snapshot.items,
      subtotal: snapshot.subtotal || formatAmount(Number(invoice.netAmount)),
      taxAmount: snapshot.taxAmount || formatAmount(Number(invoice.vatAmount)),
      total: snapshot.total || formatAmount(Number(invoice.grossAmount)),
      paymentTermsDays: effectiveClient.paymentTermsDays,
    };
  }

  const rates = resolveRates(effectiveClient);
  const surcharges = resolveSurcharges(effectiveClient);
  const nightWindow = resolveNightWindow(effectiveClient);

  const getHolidays = (year: number) => Array.from(germanHolidays(year).keys());
  const isHoliday = (dateStr: string) => getHolidays(parseInt(dateStr.slice(0, 4), 10)).includes(dateStr);

  // Determine if this invoice was historically finalized & sent under legacy break rules (breakMinutes || 30)
  // so the generated PDF matches the exact historical invoice sent to the client.
  let isLegacySent = false;
  if (snapshot?.emailSent?.sentAt) {
    let testLegacySum = 0;
    let testNewSum = 0;
    for (const a of assignments) {
      const dStr = a.order.shiftDate.toISOString().slice(0, 10);
      const q = a.order.requiredQualification as Qualification;
      const bRate = rateFor(q, rates);
      const splitLeg = shiftSurchargeHours(dStr, a.order.startTime, a.order.endTime, a.order.breakMinutes || 30, isHoliday, nightWindow);
      for (const ch of splitLeg.values()) {
        let r = bRate;
        if (ch.components.includes("sat")) r += bRate * surcharges.sat;
        if (ch.components.includes("sun")) r += bRate * surcharges.sun;
        if (ch.components.includes("holiday")) r += bRate * surcharges.holiday;
        if (ch.components.includes("night")) r += bRate * surcharges.night;
        testLegacySum += ch.hours * r;
      }
      const splitN = shiftSurchargeHours(dStr, a.order.startTime, a.order.endTime, a.order.breakMinutes ?? 30, isHoliday, nightWindow);
      for (const ch of splitN.values()) {
        let r = bRate;
        if (ch.components.includes("sat")) r += bRate * surcharges.sat;
        if (ch.components.includes("sun")) r += bRate * surcharges.sun;
        if (ch.components.includes("holiday")) r += bRate * surcharges.holiday;
        if (ch.components.includes("night")) r += bRate * surcharges.night;
        testNewSum += ch.hours * r;
      }
    }
    const netAdj = typeof snapshot.netAdjustment === "number" ? snapshot.netAdjustment : 0;
    testLegacySum += netAdj;
    testNewSum += netAdj;
    const invNet = Number(invoice.netAmount);
    if (Math.abs(testLegacySum - invNet) < 0.1 && Math.abs(testNewSum - invNet) >= 0.1) {
      isLegacySent = true;
    }
  }

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
    const effectiveBreakMinutes = isLegacySent ? (a.order.breakMinutes || 30) : (a.order.breakMinutes ?? 30);
    const split = shiftSurchargeHours(shiftDateStr, a.order.startTime, a.order.endTime, effectiveBreakMinutes, isHoliday, nightWindow);
    
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

  // Handle Net Adjustment (Zu- oder Abschlag auf Netto-Betrag)
  const netAdjustment = typeof snapshot.netAdjustment === "number" ? snapshot.netAdjustment : 0;
  if (netAdjustment !== 0) {
    const reason = snapshot.adjustmentReason?.trim() || (netAdjustment < 0 ? "Abschlag (Netto)" : "Zuschlag (Netto)");
    items.push({
      pos: pos++,
      description: reason,
      hours: "-",
      rate: "-",
      amount: formatAmount(netAdjustment),
    });
  }

  const allAssignments = [...assignments].sort((a, b) => a.order.shiftDate.getTime() - b.order.shiftDate.getTime());
  const periodStart = allAssignments[0] ? format(allAssignments[0].order.shiftDate, "dd.MM.yyyy") : "";
  const periodEnd = allAssignments[allAssignments.length - 1] ? format(allAssignments[allAssignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "";

  // Derive net subtotal directly from calculated line items when items exist,
  // falling back to invoice.netAmount if no items were generated.
  const computedNet = items.length > 0
    ? items.reduce((sum, item) => {
        // parse amount string e.g. "6.330,36 €" or "100,50 €"
        const numStr = item.amount.replace(" €", "").replace(/\./g, "").replace(",", ".");
        const val = parseFloat(numStr);
        return sum + (isNaN(val) ? 0 : val);
      }, 0)
    : Number(invoice.netAmount);

  const roundedNet = Math.round(computedNet * 100) / 100;
  const net = roundedNet;
  const vat = Math.round(net * 0.19 * 100) / 100;
  const gross = Math.round((net + vat) * 100) / 100;

  return {
    invoiceNumber: invoice.invoiceNumber,
    date: format(invoice.date || new Date(), "dd.MM.yyyy"),
    clientId: effectiveClient.internalNumber || effectiveClient.shortCode || effectiveClient.id.substring(0, 8),
    clientName: effectiveClient.facilityName,
    billingInfo: effectiveClient.billingInfo || null,
    clientAddress: buildAddressString(effectiveClient) || "Adresse unbekannt",
    periodStart,
    periodEnd,
    items,
    subtotal: formatAmount(net),
    taxAmount: formatAmount(vat),
    total: formatAmount(gross),
    paymentTermsDays: effectiveClient.paymentTermsDays,
  };
}

