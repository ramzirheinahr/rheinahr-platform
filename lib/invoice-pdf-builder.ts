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

import { isV2CalculationVersion } from "@/lib/invoice-calculation-version";

export function parseGermanCurrencyStringToCents(val: unknown): number {
  if (typeof val !== "string") {
    throw new Error(
      `Ungültiger Betragswert (erwartet String im deutschen Währungsformat mit Komma): ${typeof val}`
    );
  }
  const trimmed = val.trim();
  if (!trimmed) {
    throw new Error("Leerer Betragswert kann nicht in Cent umgewandelt werden.");
  }
  // Strict German currency format: optional sign, digits with optional thousands dots, EXACTLY two decimal digits after comma, optional trailing €
  const germanCurrencyRegex = /^(-)?(?:([0-9]{1,3}(?:\.[0-9]{3})*)|([0-9]+)),([0-9]{2})(?:\s*€)?$/;
  const match = germanCurrencyRegex.exec(trimmed);
  if (!match) {
    throw new Error(
      `Ungültiges deutsches Währungsformat: "${val}" (erwartet genau 2 Nachkommastellen mit Komma, z. B. '5,68 €').`
    );
  }
  const isNegative = Boolean(match[1]);
  const euroPartStr = (match[2] ?? match[3]).replace(/\./g, "");
  const centsPartStr = match[4];
  const totalCentsBigInt = BigInt(euroPartStr) * BigInt(100) + BigInt(centsPartStr);
  const totalCentsNum = Number(totalCentsBigInt);
  if (!Number.isSafeInteger(totalCentsNum)) {
    throw new Error(`Betrag überschreitet den sicheren Ganzzahlbereich: "${val}"`);
  }
  return isNegative ? -totalCentsNum : totalCentsNum;
}

export function buildInvoicePdfData(
  invoice: Pick<Invoice, "invoiceNumber" | "date" | "netAmount" | "vatAmount" | "grossAmount"> & {
    snapshotData?: unknown;
  },
  client: Pick<Client, "id" | "shortCode" | "internalNumber" | "facilityName" | "address" | "billingEmail" | "billingInfo" | "hourlyRates" | "surchargeSat" | "surchargeSun" | "surchargeHoliday" | "surchargeNight" | "nightStart" | "nightEnd" | "paymentTermsDays">,
  assignments: (Pick<Assignment, "id"> & { order: Pick<Order, "requiredQualification" | "shiftDate" | "startTime" | "endTime" | "breakMinutes">, worker: Pick<Worker, "fullName"> })[],
  options?: { forceRecalculate?: boolean }
): InvoicePdfData {
  // If the invoice has a snapshot of the client data (prices, address, etc.), use it. 
  // Otherwise fallback to current live client data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = ((invoice as any).snapshotData as any) || {};
  const effectiveClient = { ...client, ...snapshot } as typeof client;

  // Modern V2 Calculation Path: Strictly frozen, read only from snapshotData
  if (isV2CalculationVersion(snapshot)) {
    if (options?.forceRecalculate) {
      throw new Error(
        "forceRecalculate is strictly forbidden for V2 invoices: V2 invoices are permanently immutable and must only be read from frozen snapshotData."
      );
    }

    if (!Array.isArray(snapshot.pdfItems) || snapshot.pdfItems.length === 0) {
      throw new Error("Corrupted V2 invoice: snapshotData.pdfItems is missing or empty.");
    }

    const { subtotalCents, taxAmountCents, totalCents } = snapshot;
    if (
      typeof subtotalCents !== "number" ||
      typeof taxAmountCents !== "number" ||
      typeof totalCents !== "number" ||
      !Number.isSafeInteger(subtotalCents) ||
      !Number.isSafeInteger(taxAmountCents) ||
      !Number.isSafeInteger(totalCents)
    ) {
      throw new Error("Corrupted V2 invoice: snapshotData cent totals are missing or invalid integers.");
    }

    if (subtotalCents + taxAmountCents !== totalCents) {
      throw new Error(
        `Corrupted V2 invoice mathematical integrity error: totalCents (${totalCents}) !== subtotalCents (${subtotalCents}) + taxAmountCents (${taxAmountCents}).`
      );
    }

    // Parity check against stored DB amounts
    const dbNetCents = Math.round(Number(invoice.netAmount) * 100);
    const dbVatCents = Math.round(Number(invoice.vatAmount) * 100);
    const dbGrossCents = Math.round(Number(invoice.grossAmount) * 100);

    if (
      dbNetCents !== subtotalCents ||
      dbVatCents !== taxAmountCents ||
      dbGrossCents !== totalCents
    ) {
      throw new Error(
        `Corrupted V2 invoice amounts: DB amounts (${dbNetCents}, ${dbVatCents}, ${dbGrossCents}) do not match frozen snapshot cent totals (${subtotalCents}, ${taxAmountCents}, ${totalCents}).`
      );
    }

    // Parity check between string representations and cent values
    if (
      typeof snapshot.subtotal !== "string" ||
      parseGermanCurrencyStringToCents(snapshot.subtotal) !== subtotalCents
    ) {
      throw new Error(
        `Corrupted V2 invoice: snapshotData.subtotal ("${snapshot.subtotal}") stimmt nicht mit subtotalCents (${subtotalCents}) überein.`
      );
    }
    if (
      typeof snapshot.taxAmount !== "string" ||
      parseGermanCurrencyStringToCents(snapshot.taxAmount) !== taxAmountCents
    ) {
      throw new Error(
        `Corrupted V2 invoice: snapshotData.taxAmount ("${snapshot.taxAmount}") stimmt nicht mit taxAmountCents (${taxAmountCents}) überein.`
      );
    }
    if (
      typeof snapshot.total !== "string" ||
      parseGermanCurrencyStringToCents(snapshot.total) !== totalCents
    ) {
      throw new Error(
        `Corrupted V2 invoice: snapshotData.total ("${snapshot.total}") stimmt nicht mit totalCents (${totalCents}) überein.`
      );
    }

    // Clean items and verify row amounts
    let sumPdfItemsCents = 0;
    const sanitizedItems = (snapshot.pdfItems as Record<string, unknown>[]).map((item, idx) => {
      const pos = Number(item.pos);
      if (!Number.isSafeInteger(pos) || pos <= 0) {
        throw new Error(`Corrupted V2 invoice: Ungültige Zeilenposition in pdfItems an Index ${idx}: ${item.pos}`);
      }
      const desc = String(item.description || "").trim();
      if (!desc) {
        throw new Error(`Corrupted V2 invoice: Fehlende Zeilenbeschreibung in pdfItems bei Position ${pos}.`);
      }
      const hours = String(item.hours || "").trim();
      if (!hours) {
        throw new Error(`Corrupted V2 invoice: Fehlende Stundenangabe in pdfItems bei Position ${pos}.`);
      }
      const rate = typeof item.rate === "string" ? item.rate.replace(/\s*€$/, "").trim() : String(item.rate ?? "").trim();
      if (!rate) {
        throw new Error(`Corrupted V2 invoice: Fehlender Stundensatz in pdfItems bei Position ${pos}.`);
      }
      const amountStr = typeof item.amount === "string" ? item.amount.trim() : String(item.amount ?? "").trim();
      if (!amountStr) {
        throw new Error(`Corrupted V2 invoice: Fehlender Betrag in pdfItems bei Position ${pos}.`);
      }

      const itemCents = parseGermanCurrencyStringToCents(amountStr);
      sumPdfItemsCents += itemCents;

      return {
        pos,
        description: desc,
        hours,
        rate,
        amount: amountStr,
      };
    });

    if (sumPdfItemsCents !== subtotalCents) {
      throw new Error(
        `Corrupted V2 invoice line item sum mismatch: sum of pdfItems amounts (${sumPdfItemsCents} Cent) does not match frozen subtotalCents (${subtotalCents} Cent).`
      );
    }

    // Strict mandatory verification of frozen snapshotData.items for V2 invoices
    if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) {
      throw new Error(
        "Corrupted V2 invoice: snapshotData.items ist zwingend erforderlich und darf nicht fehlen oder leer sein."
      );
    }

    if (snapshot.items.length !== sanitizedItems.length) {
      throw new Error(
        `Corrupted V2 invoice items count mismatch: snapshotData.items (${snapshot.items.length}) does not match pdfItems (${sanitizedItems.length}).`
      );
    }

    for (let i = 0; i < sanitizedItems.length; i++) {
      const snapItem = snapshot.items[i] as Record<string, unknown> | undefined;
      const pdfItem = sanitizedItems[i];

      if (!snapItem || typeof snapItem !== "object") {
        throw new Error(`Corrupted V2 invoice: snapshotData.items[${i}] ist kein gültiges Objekt.`);
      }

      if (typeof snapItem.amountCents !== "number" || !Number.isSafeInteger(snapItem.amountCents)) {
        throw new Error(
          `Corrupted V2 invoice: snapshotData.items[${i}].amountCents fehlt oder ist keine gültige Ganzzahl.`
        );
      }

      if (typeof snapItem.pos !== "number" || snapItem.pos !== pdfItem.pos) {
        throw new Error(
          `Corrupted V2 invoice pos mismatch at index ${i}: snapshotData.items.pos (${snapItem.pos}) does not match pdfItems pos (${pdfItem.pos}).`
        );
      }

      // Parity check for displayed hours
      const snapHoursDisplay = typeof snapItem.hoursDisplay === "string" ? snapItem.hoursDisplay.trim() : "";
      if (!snapHoursDisplay || snapHoursDisplay !== pdfItem.hours.trim()) {
        throw new Error(
          `Corrupted V2 invoice hours mismatch at pos ${pdfItem.pos}: snapshotData.items.hoursDisplay ("${snapHoursDisplay}") does not match pdfItems hours ("${pdfItem.hours}").`
        );
      }

      // Parity check for displayed rate
      const rawSnapRate = typeof snapItem.rateDisplay === "string"
        ? snapItem.rateDisplay
        : (typeof snapItem.rateDecimal === "string" ? snapItem.rateDecimal.replace(".", ",") : "");
      const snapRateClean = rawSnapRate.replace(/\s*€$/, "").trim();
      const pdfRateClean = pdfItem.rate.replace(/\s*€$/, "").trim();
      if (!snapRateClean || snapRateClean !== pdfRateClean) {
        throw new Error(
          `Corrupted V2 invoice rate mismatch at pos ${pdfItem.pos}: snapshotData.items rate ("${snapRateClean}") does not match pdfItems rate ("${pdfRateClean}").`
        );
      }

      // Parity check for line amount
      const pdfItemCents = parseGermanCurrencyStringToCents(pdfItem.amount);
      if (snapItem.amountCents !== pdfItemCents) {
        throw new Error(
          `Corrupted V2 invoice item amount mismatch at pos ${pdfItem.pos}: snapshotData.items.amountCents (${snapItem.amountCents}) does not match pdfItems amount (${pdfItemCents} Cent).`
        );
      }
    }

    return {
      invoiceNumber: invoice.invoiceNumber,
      date: snapshot.date || format(invoice.date || new Date(), "dd.MM.yyyy"),
      clientId:
        snapshot.internalNumber ||
        snapshot.shortCode ||
        effectiveClient.internalNumber ||
        effectiveClient.shortCode ||
        effectiveClient.id?.substring(0, 8) ||
        "UNKNOWN",
      clientName: snapshot.facilityName || effectiveClient.facilityName,
      billingInfo:
        snapshot.billingInfo !== undefined
          ? snapshot.billingInfo
          : effectiveClient.billingInfo || null,
      clientAddress:
        snapshot.address || buildAddressString(effectiveClient) || "Adresse unbekannt",
      periodStart: snapshot.periodStart || "",
      periodEnd: snapshot.periodEnd || "",
      items: sanitizedItems,
      subtotal: snapshot.subtotal,
      taxAmount: snapshot.taxAmount,
      total: snapshot.total,
      paymentTermsDays: snapshot.paymentTermsDays ?? effectiveClient.paymentTermsDays ?? 14,
    };
  }

  // If the invoice has an immutable frozen snapshot of the items, return them directly (unless forceRecalculate is requested).
  if (!options?.forceRecalculate && Array.isArray(snapshot.items) && snapshot.items.length > 0) {
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

  for (const [, group] of grouped.entries()) {
    const baseRate = rateFor(group.qual, rates);
    const qName = qualLabel[group.qual] || group.qual;
    const wName = group.workerName;

    if (group.baseHours > 0) {
      const sorted = [...group.assignments].sort((a, b) => a.order.shiftDate.getTime() - b.order.shiftDate.getTime());
      const startStr = sorted[0] ? format(sorted[0].order.shiftDate, "dd.MM.yyyy") : "";
      const endStr = sorted[sorted.length - 1] ? format(sorted[sorted.length - 1].order.shiftDate, "dd.MM.yyyy") : "";
      const roundedH = Math.round(group.baseHours * 100) / 100;
      const roundedR = Math.round(baseRate * 100) / 100;
      const lineAmt = Math.round(roundedH * roundedR * 100) / 100;
      items.push({
        pos: pos++,
        description: `${wName} (${qName}) vom ${startStr} bis ${endStr}`,
        hours: formatNumber(roundedH),
        rate: formatNumber(roundedR),
        amount: formatAmount(lineAmt),
      });
    }
    if (group.satHours > 0) {
      const sRate = baseRate * surcharges.sat;
      const roundedH = Math.round(group.satHours * 100) / 100;
      const roundedR = Math.round(sRate * 100) / 100;
      const lineAmt = Math.round(roundedH * roundedR * 100) / 100;
      items.push({
        pos: pos++,
        description: `Samstagzuschlag (${wName}) ${surcharges.sat * 100}%`,
        hours: formatNumber(roundedH),
        rate: formatNumber(roundedR),
        amount: formatAmount(lineAmt),
      });
    }
    if (group.nightHours > 0) {
      const sRate = baseRate * surcharges.night;
      const roundedH = Math.round(group.nightHours * 100) / 100;
      const roundedR = Math.round(sRate * 100) / 100;
      const lineAmt = Math.round(roundedH * roundedR * 100) / 100;
      items.push({
        pos: pos++,
        description: `Nachtzuschlag (${nightWindow.start}-${nightWindow.end}) (${wName}) ${surcharges.night * 100}%`,
        hours: formatNumber(roundedH),
        rate: formatNumber(roundedR),
        amount: formatAmount(lineAmt),
      });
    }
    if (group.sunHours > 0) {
      const sRate = baseRate * surcharges.sun;
      const roundedH = Math.round(group.sunHours * 100) / 100;
      const roundedR = Math.round(sRate * 100) / 100;
      const lineAmt = Math.round(roundedH * roundedR * 100) / 100;
      items.push({
        pos: pos++,
        description: `Sonntagzuschlag (${wName}) ${surcharges.sun * 100}%`,
        hours: formatNumber(roundedH),
        rate: formatNumber(roundedR),
        amount: formatAmount(lineAmt),
      });
    }
    if (group.holidayHours > 0) {
      const sRate = baseRate * surcharges.holiday;
      const roundedH = Math.round(group.holidayHours * 100) / 100;
      const roundedR = Math.round(sRate * 100) / 100;
      const lineAmt = Math.round(roundedH * roundedR * 100) / 100;
      items.push({
        pos: pos++,
        description: `Feiertagszuschlag (${wName}) ${surcharges.holiday * 100}%`,
        hours: formatNumber(roundedH),
        rate: formatNumber(roundedR),
        amount: formatAmount(lineAmt),
      });
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

