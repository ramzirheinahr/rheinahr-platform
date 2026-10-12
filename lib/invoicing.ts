import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ConfirmationMethod } from "@prisma/client";
import type { Qualification } from "@/lib/validations";

export type InvoiceRow = {
  shiftDate: string; // YYYY-MM-DD
  facilityName: string;
  workerName: string;
  qualification: Qualification;
  startTime: string;
  endTime: string;
  hours: number;
  method: ConfirmationMethod;
  confirmedAt: string; // ISO
  orderId: string;
  assignmentId: string;
};

// German business labels for the export (DATEV / accounting is German-language).
export const qualLabel: Record<Qualification, string> = {
  pflegefachkraft: "Pflegefachkraft",
  pflegehelfer: "Pflegehilfskraft",
  betreuungskraft: "Pflegefachassistent*in",
  pflegedienstleitung: "Pflegedienstleitung",
  kuechenhilfe: "Küchenhilfe",
  hausmeister: "Hausmeister",
};
export const methodLabel: Record<ConfirmationMethod, string> = {
  electronic: "Elektronische Unterschrift",
  upload: "Dokument-Upload",
};

// Confirmed services in an optional [from, to] shift-date range (inclusive).
export async function getConfirmedServices(opts: {
  from?: string;
  to?: string;
}): Promise<InvoiceRow[]> {
  const shiftDate: { gte?: Date; lt?: Date } = {};
  if (opts.from) shiftDate.gte = new Date(`${opts.from}T00:00:00.000Z`);
  if (opts.to) {
    const end = new Date(`${opts.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1); // inclusive end day
    shiftDate.lt = end;
  }

  const rows = await prisma.serviceConfirmation.findMany({
    where:
      shiftDate.gte || shiftDate.lt
        ? { assignment: { order: { shiftDate } } }
        : undefined,
    orderBy: { confirmedAt: "desc" },
    select: {
      hoursWorked: true,
      method: true,
      confirmedAt: true,
      assignment: {
        select: {
          id: true,
          worker: { select: { fullName: true, qualification: true } },
          order: {
            select: {
              id: true,
              shiftDate: true,
              startTime: true,
              endTime: true,
              client: { select: { facilityName: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    shiftDate: r.assignment.order.shiftDate.toISOString().slice(0, 10),
    facilityName: r.assignment.order.client.facilityName,
    workerName: r.assignment.worker.fullName,
    qualification: r.assignment.worker.qualification,
    startTime: r.assignment.order.startTime,
    endTime: r.assignment.order.endTime,
    hours: Number(r.hoursWorked ?? 0),
    method: r.method,
    confirmedAt: r.confirmedAt.toISOString(),
    orderId: r.assignment.order.id,
    assignmentId: r.assignment.id,
  }));
}

function csvCell(value: string | number): string {
  const s = String(value);
  // Quote when the cell contains the delimiter, quotes or a newline.
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Semicolon-delimited CSV with UTF-8 BOM (Excel/DATEV-friendly).
export function toCsv(rows: InvoiceRow[]): string {
  const headers = [
    "Datum",
    "Einrichtung",
    "Mitarbeiter",
    "Qualifikation",
    "Beginn",
    "Ende",
    "Stunden",
    "Methode",
    "Bestätigt am",
    "Auftrag-ID",
    "Einsatz-ID",
  ];
  const lines = [headers.join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.shiftDate,
        r.facilityName,
        r.workerName,
        qualLabel[r.qualification],
        r.startTime,
        r.endTime,
        r.hours.toString().replace(".", ","), // German decimal comma
        methodLabel[r.method],
        r.confirmedAt.slice(0, 16).replace("T", " "),
        r.orderId,
        r.assignmentId,
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  return "﻿" + lines.join("\r\n");
}

/**
 * Calculates the next sequential invoice number based on the highest existing invoice sequence.
 * This avoids collisions when past invoices have been deleted or when numbers have gaps.
 */
export async function getNextInvoiceSequenceNumber(): Promise<number> {
  const invoices = await prisma.invoice.findMany({
    select: { invoiceNumber: true },
  });

  let maxSeq = 303; // Invoices start at 304 if none exist
  for (const inv of invoices) {
    const match = inv.invoiceNumber.match(/^(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  return maxSeq + 1;
}

/**
 * Generates a guaranteed unique invoice number in the standard company format:
 * `${seqNumber}-${identifier}-${monthStr}${yearStr}` (e.g. `476-268-0726`).
 */
export async function generateUniqueInvoiceNumber({
  identifier,
  date,
  customInvoiceNumber,
}: {
  identifier: string;
  date: Date;
  customInvoiceNumber?: string;
}): Promise<string> {
  if (customInvoiceNumber && customInvoiceNumber.trim() !== "") {
    const trimmed = customInvoiceNumber.trim();
    const existing = await prisma.invoice.findUnique({
      where: { invoiceNumber: trimmed },
    });
    if (existing) {
      throw new Error(`Die Rechnungsnummer "${trimmed}" ist bereits vergeben.`);
    }
    return trimmed;
  }

  let nextSeq = await getNextInvoiceSequenceNumber();
  const monthStr = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yearStr = String(date.getUTCFullYear()).slice(-2);

  let candidate = `${nextSeq}-${identifier}-${monthStr}${yearStr}`;
  while (await prisma.invoice.findUnique({ where: { invoiceNumber: candidate } })) {
    nextSeq++;
    candidate = `${nextSeq}-${identifier}-${monthStr}${yearStr}`;
  }

  return candidate;
}

export function buildInvoicingWhereClause(params: {
  from: Date;
  to: Date;
  query?: string;
}): Prisma.InvoiceWhereInput {
  const { from, to, query = "" } = params;
  const words = query.trim().split(/\s+/).filter(Boolean);

  const where: Prisma.InvoiceWhereInput = {
    OR: [
      {
        status: "cancelled",
        date: { gte: from, lte: to },
      },
      {
        status: { not: "cancelled" },
        OR: [
          {
            assignments: {
              some: {
                order: {
                  shiftDate: { gte: from, lte: to },
                },
              },
            },
          },
          {
            assignments: { none: {} },
            date: { gte: from, lte: to },
          },
        ],
      },
    ],
  };

  if (words.length > 0) {
    where.AND = words.map((w) => ({
      OR: [
        { invoiceNumber: { contains: w, mode: "insensitive" } },
        { client: { facilityName: { contains: w, mode: "insensitive" } } },
        {
          snapshotData: {
            path: ["facilityName"],
            string_contains: w,
            mode: "insensitive",
          },
        },
      ],
    }));
  }

  return where;
}

export function getInvoiceFacilityName(invoice: {
  client?: { facilityName?: string | null } | null;
  snapshotData?: unknown;
}): string {
  const snapshot =
    invoice.snapshotData && typeof invoice.snapshotData === "object"
      ? (invoice.snapshotData as Record<string, unknown>)
      : null;
  const snapshotFacility =
    typeof snapshot?.facilityName === "string" ? snapshot.facilityName.trim() : "";
  if (snapshotFacility) return snapshotFacility;
  return invoice.client?.facilityName?.trim() || "—";
}

export function parseCurrencyAmountToCents(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) {
    return Math.round(val * 100);
  }
  if (typeof val === "string") {
    const cleaned = val.replace(/\s*€\s*$/, "").trim();
    if (!cleaned) return null;
    if (/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(cleaned) || /^-?\d+,\d{2}$/.test(cleaned)) {
      const euroStr = cleaned.split(",")[0].replace(/\./g, "");
      const centStr = cleaned.split(",")[1];
      const sign = cleaned.startsWith("-") ? -1 : 1;
      return sign * (Math.abs(parseInt(euroStr, 10)) * 100 + parseInt(centStr, 10));
    }
    if (/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      return Math.round(parseFloat(cleaned) * 100);
    }
  }
  return null;
}

export const formatNumber = (num: number): string => num.toFixed(2).replace(".", ",");
export const formatAmount = (num: number): string => `${formatNumber(num)} €`;

export function parseGermanOrDecimalNumber(val: unknown): number | null {
  if (typeof val === "number") return isNaN(val) ? null : val;
  if (typeof val !== "string") return null;
  const s = val.replace(/\s*€\s*$/, "").trim();
  if (!s) return null;
  // German format: "1.234,56" or "10,00"
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) {
    const cleaned = s.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  // Standard decimal: "1234.56" or "10.00"
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
  }
  return null;
}

export type NormalizedHistoricalItem = {
  pos: number;
  description: string;
  hours: string;
  rate: string;
  amount: string;
  hoursNum: number;
  rateNum: number | null;
  amountCents: number;
};

/**
 * Universal normalization helper for historical invoice line items.
 * Guarantees that every accepted format is validated for consistency:
 * - Rejects any item where different amount representations conflict (e.g. amountCents != amount string).
 * - Rejects invalid, unparseable, or negative/zero amounts and hours.
 * - Enforces consistency among hour representations.
 * - Strictly avoids fabricating an hourly rate from amount/hours when not recorded on the item.
 */
export function normalizeHistoricalItem(
  rawItem: unknown,
  fallbackPos: number = 1
): NormalizedHistoricalItem | null {
  if (!rawItem || typeof rawItem !== "object") return null;
  const it = rawItem as Record<string, unknown>;

  // 1. Description: mandatory non-empty string
  const description = typeof it.description === "string" ? it.description.trim() : "";
  if (!description) return null;

  // 2. Position
  const pos =
    typeof it.pos === "number" && Number.isSafeInteger(it.pos) && it.pos > 0
      ? it.pos
      : fallbackPos;

  // 3. Hours: collect all present representations and enforce consistency
  const hourValues: number[] = [];
  if (it.hours !== undefined && it.hours !== null && String(it.hours).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.hours);
    if (val === null || val <= 0) return null;
    hourValues.push(val);
  }
  if (it.hoursDisplay !== undefined && it.hoursDisplay !== null && String(it.hoursDisplay).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.hoursDisplay);
    if (val === null || val <= 0) return null;
    hourValues.push(val);
  }
  if (it.hoursDecimal !== undefined && it.hoursDecimal !== null && String(it.hoursDecimal).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.hoursDecimal);
    if (val === null || val <= 0) return null;
    hourValues.push(val);
  }
  if (it.displayHourHundredths !== undefined && it.displayHourHundredths !== null) {
    if (typeof it.displayHourHundredths !== "number" || isNaN(it.displayHourHundredths) || it.displayHourHundredths <= 0) {
      return null;
    }
    hourValues.push(it.displayHourHundredths / 100);
  }
  if (it.rawMinutes !== undefined && it.rawMinutes !== null) {
    if (typeof it.rawMinutes !== "number" || isNaN(it.rawMinutes) || it.rawMinutes <= 0) {
      return null;
    }
    hourValues.push(it.rawMinutes / 60);
  }
  if (it.quantity !== undefined && it.quantity !== null && String(it.quantity).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.quantity);
    if (val === null || val <= 0) return null;
    hourValues.push(val);
  }
  if (it.count !== undefined && it.count !== null && String(it.count).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.count);
    if (val === null || val <= 0) return null;
    hourValues.push(val);
  }

  if (hourValues.length === 0) return null;

  const expectedHours = hourValues[0];
  for (let idx = 1; idx < hourValues.length; idx++) {
    if (Math.abs(hourValues[idx] - expectedHours) > 0.001) {
      return null; // Conflicting hours representations
    }
  }
  const hoursNum = expectedHours;

  const hoursDisplay =
    typeof it.hours === "string" && it.hours.trim() && parseGermanOrDecimalNumber(it.hours) !== null
      ? it.hours.trim()
      : typeof it.hoursDisplay === "string" && it.hoursDisplay.trim() && parseGermanOrDecimalNumber(it.hoursDisplay) !== null
      ? it.hoursDisplay.trim()
      : formatNumber(hoursNum);

  // 4. Amount: collect all representations, enforce exact cents match and consistency
  const centValues: number[] = [];

  if (it.amountCents !== undefined && it.amountCents !== null) {
    if (typeof it.amountCents !== "number" || !Number.isSafeInteger(it.amountCents) || it.amountCents <= 0) {
      return null;
    }
    centValues.push(it.amountCents);
  }
  if (it.totalCents !== undefined && it.totalCents !== null) {
    if (typeof it.totalCents !== "number" || !Number.isSafeInteger(it.totalCents) || it.totalCents <= 0) {
      return null;
    }
    centValues.push(it.totalCents);
  }
  if (it.lineTotalCents !== undefined && it.lineTotalCents !== null) {
    if (typeof it.lineTotalCents !== "number" || !Number.isSafeInteger(it.lineTotalCents) || it.lineTotalCents <= 0) {
      return null;
    }
    centValues.push(it.lineTotalCents);
  }

  const textKeys = ["amount", "total", "lineTotal", "totalNet"] as const;
  for (const k of textKeys) {
    const raw = it[k];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const parsed = parseCurrencyAmountToCents(raw);
      if (parsed === null || parsed <= 0) {
        return null; // unparseable, zero or negative
      }
      centValues.push(parsed);
    }
  }

  if (centValues.length === 0) return null;

  const expectedCents = centValues[0];
  for (let idx = 1; idx < centValues.length; idx++) {
    if (centValues[idx] !== expectedCents) {
      // Conflicting amounts between representations! (e.g. amountCents: 50000 vs amount: "600,00 €")
      return null;
    }
  }
  const amountCents = expectedCents;

  let amountDisplay = "";
  if (typeof it.amount === "string" && it.amount.trim() && parseCurrencyAmountToCents(it.amount) === amountCents) {
    amountDisplay = it.amount.includes("€") ? it.amount.trim() : `${it.amount.trim()} €`;
  } else if (typeof it.total === "string" && it.total.trim() && parseCurrencyAmountToCents(it.total) === amountCents) {
    amountDisplay = it.total.includes("€") ? it.total.trim() : `${it.total.trim()} €`;
  } else if (typeof it.lineTotal === "string" && it.lineTotal.trim() && parseCurrencyAmountToCents(it.lineTotal) === amountCents) {
    amountDisplay = it.lineTotal.includes("€") ? it.lineTotal.trim() : `${it.lineTotal.trim()} €`;
  } else {
    amountDisplay = formatAmount(amountCents / 100);
  }

  // 5. Rate: collect all explicit representations and enforce consistency
  const rateValues: number[] = [];
  if (it.rate !== undefined && it.rate !== null && String(it.rate).trim() !== "") {
    const val = parseGermanOrDecimalNumber(typeof it.rate === "string" ? it.rate.replace(/\s*€$/, "") : it.rate);
    if (val === null || val <= 0) return null;
    rateValues.push(val);
  }
  if (it.rateDisplay !== undefined && it.rateDisplay !== null && String(it.rateDisplay).trim() !== "") {
    const val = parseGermanOrDecimalNumber(typeof it.rateDisplay === "string" ? it.rateDisplay.replace(/\s*€$/, "") : it.rateDisplay);
    if (val === null || val <= 0) return null;
    rateValues.push(val);
  }
  if (it.rateDecimal !== undefined && it.rateDecimal !== null && String(it.rateDecimal).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.rateDecimal);
    if (val === null || val <= 0) return null;
    rateValues.push(val);
  }
  if (it.rateCents !== undefined && it.rateCents !== null) {
    if (typeof it.rateCents !== "number" || !Number.isSafeInteger(it.rateCents) || it.rateCents <= 0) return null;
    rateValues.push(it.rateCents / 100);
  }
  if (it.hourlyRateInCents !== undefined && it.hourlyRateInCents !== null) {
    if (typeof it.hourlyRateInCents !== "number" || !Number.isSafeInteger(it.hourlyRateInCents) || it.hourlyRateInCents <= 0) return null;
    rateValues.push(it.hourlyRateInCents / 100);
  }
  if (it.hourlyRate !== undefined && it.hourlyRate !== null && String(it.hourlyRate).trim() !== "") {
    const val = parseGermanOrDecimalNumber(it.hourlyRate);
    if (val === null || val <= 0) return null;
    rateValues.push(val);
  }

  let rateNum: number | null = null;
  let rateDisplay = "";
  if (rateValues.length > 0) {
    const expectedRate = rateValues[0];
    for (let idx = 1; idx < rateValues.length; idx++) {
      if (Math.abs(rateValues[idx] - expectedRate) > 0.01) {
        return null; // Conflicting rates!
      }
    }
    rateNum = expectedRate;
    rateDisplay =
      typeof it.rate === "string" && it.rate.trim()
        ? it.rate.replace(/\s*€$/, "").trim()
        : typeof it.rateDisplay === "string" && it.rateDisplay.trim()
        ? it.rateDisplay.replace(/\s*€$/, "").trim()
        : formatNumber(rateNum);
  } else {
    // Strictly avoid deriving rate from amount/hours when absent from snapshot
    rateNum = null;
    rateDisplay = "";
  }

  return {
    pos,
    description,
    hours: hoursDisplay,
    rate: rateDisplay,
    amount: amountDisplay,
    hoursNum,
    rateNum,
    amountCents,
  };
}

export interface ValidatedMonetaryTotals {
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  subtotalDisplay: string;
  taxAmountDisplay: string;
  totalDisplay: string;
}

/**
 * Validates the monetary totals (net/subtotal, tax/vat, gross/total) stored in an invoice snapshot.
 * Enforces strict, fail-closed consistency between all present representations:
 * - Integer cent fields (subtotalCents, netAmountCents, taxAmountCents, vatAmountCents, totalCents, grossAmountCents)
 * - Text strings or formatted numbers (subtotal, netAmount, taxAmount, vatAmount, total, grossAmount)
 *
 * If ANY field representation conflicts with another within the same total group, returns null.
 * If any of the three total groups is completely missing or unparseable, returns null.
 */
export function validateSnapshotMonetaryTotals(
  snapshot: unknown
): ValidatedMonetaryTotals | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const s = snapshot as Record<string, unknown>;

  // 1. Subtotal / Net
  const subtotalCentValues: number[] = [];
  if (s.subtotalCents !== undefined && s.subtotalCents !== null) {
    if (typeof s.subtotalCents !== "number" || !Number.isSafeInteger(s.subtotalCents)) {
      return null;
    }
    subtotalCentValues.push(s.subtotalCents);
  }
  if (s.netAmountCents !== undefined && s.netAmountCents !== null) {
    if (typeof s.netAmountCents !== "number" || !Number.isSafeInteger(s.netAmountCents)) {
      return null;
    }
    subtotalCentValues.push(s.netAmountCents);
  }
  for (const k of ["subtotal", "netAmount"] as const) {
    const val = s[k];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      const parsed = parseCurrencyAmountToCents(val);
      if (parsed === null) return null;
      subtotalCentValues.push(parsed);
    }
  }
  if (subtotalCentValues.length === 0) return null;
  const expectedSubtotalCents = subtotalCentValues[0];
  for (let i = 1; i < subtotalCentValues.length; i++) {
    if (subtotalCentValues[i] !== expectedSubtotalCents) {
      return null; // Conflicting subtotal representations!
    }
  }

  // 2. Tax / VAT
  const taxCentValues: number[] = [];
  if (s.taxAmountCents !== undefined && s.taxAmountCents !== null) {
    if (typeof s.taxAmountCents !== "number" || !Number.isSafeInteger(s.taxAmountCents)) {
      return null;
    }
    taxCentValues.push(s.taxAmountCents);
  }
  if (s.vatAmountCents !== undefined && s.vatAmountCents !== null) {
    if (typeof s.vatAmountCents !== "number" || !Number.isSafeInteger(s.vatAmountCents)) {
      return null;
    }
    taxCentValues.push(s.vatAmountCents);
  }
  for (const k of ["taxAmount", "vatAmount"] as const) {
    const val = s[k];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      const parsed = parseCurrencyAmountToCents(val);
      if (parsed === null) return null;
      taxCentValues.push(parsed);
    }
  }
  if (taxCentValues.length === 0) return null;
  const expectedTaxCents = taxCentValues[0];
  for (let i = 1; i < taxCentValues.length; i++) {
    if (taxCentValues[i] !== expectedTaxCents) {
      return null; // Conflicting tax representations!
    }
  }

  // 3. Total / Gross
  const totalCentValues: number[] = [];
  if (s.totalCents !== undefined && s.totalCents !== null) {
    if (typeof s.totalCents !== "number" || !Number.isSafeInteger(s.totalCents)) {
      return null;
    }
    totalCentValues.push(s.totalCents);
  }
  if (s.grossAmountCents !== undefined && s.grossAmountCents !== null) {
    if (typeof s.grossAmountCents !== "number" || !Number.isSafeInteger(s.grossAmountCents)) {
      return null;
    }
    totalCentValues.push(s.grossAmountCents);
  }
  for (const k of ["total", "grossAmount"] as const) {
    const val = s[k];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      const parsed = parseCurrencyAmountToCents(val);
      if (parsed === null) return null;
      totalCentValues.push(parsed);
    }
  }
  if (totalCentValues.length === 0) return null;
  const expectedTotalCents = totalCentValues[0];
  for (let i = 1; i < totalCentValues.length; i++) {
    if (totalCentValues[i] !== expectedTotalCents) {
      return null; // Conflicting total representations!
    }
  }

  const subtotalDisplay =
    typeof s.subtotal === "string" && s.subtotal.trim() && parseCurrencyAmountToCents(s.subtotal) === expectedSubtotalCents
      ? (s.subtotal.includes("€") ? s.subtotal.trim() : `${s.subtotal.trim()} €`)
      : typeof s.netAmount === "string" && s.netAmount.trim() && parseCurrencyAmountToCents(s.netAmount) === expectedSubtotalCents
      ? (s.netAmount.includes("€") ? s.netAmount.trim() : `${s.netAmount.trim()} €`)
      : formatAmount(expectedSubtotalCents / 100);

  const taxAmountDisplay =
    typeof s.taxAmount === "string" && s.taxAmount.trim() && parseCurrencyAmountToCents(s.taxAmount) === expectedTaxCents
      ? (s.taxAmount.includes("€") ? s.taxAmount.trim() : `${s.taxAmount.trim()} €`)
      : typeof s.vatAmount === "string" && s.vatAmount.trim() && parseCurrencyAmountToCents(s.vatAmount) === expectedTaxCents
      ? (s.vatAmount.includes("€") ? s.vatAmount.trim() : `${s.vatAmount.trim()} €`)
      : formatAmount(expectedTaxCents / 100);

  const totalDisplay =
    typeof s.total === "string" && s.total.trim() && parseCurrencyAmountToCents(s.total) === expectedTotalCents
      ? (s.total.includes("€") ? s.total.trim() : `${s.total.trim()} €`)
      : typeof s.grossAmount === "string" && s.grossAmount.trim() && parseCurrencyAmountToCents(s.grossAmount) === expectedTotalCents
      ? (s.grossAmount.includes("€") ? s.grossAmount.trim() : `${s.grossAmount.trim()} €`)
      : formatAmount(expectedTotalCents / 100);

  return {
    subtotalCents: expectedSubtotalCents,
    taxAmountCents: expectedTaxCents,
    totalCents: expectedTotalCents,
    subtotalDisplay,
    taxAmountDisplay,
    totalDisplay,
  };
}

/**
 * Resolves any candidate stored PDF file path/URL from invoice or snapshotData.
 * Covers:
 * - invoice.pdfUrl
 * - snapshotData.pdfUrl
 * - snapshotData.pdfFilePath
 * - snapshotData.originalPdfPath
 * - snapshotData.storedPdfInfo.path / filePath
 * - snapshotData.archivedPdfRecord.path / filePath
 */
export function resolveStoredPdfCandidatePath(
  invoice: { pdfUrl?: string | null; snapshotData?: unknown } | null | undefined
): string | null {
  if (!invoice) return null;
  const invRecord = invoice as Record<string, unknown>;
  const snap = (invoice.snapshotData && typeof invoice.snapshotData === "object"
    ? invoice.snapshotData
    : null) as Record<string, unknown> | null;
  const storedInfo = (snap?.storedPdfInfo && typeof snap.storedPdfInfo === "object"
    ? snap.storedPdfInfo
    : null) as Record<string, unknown> | null;
  const archivedRecord = (snap?.archivedPdfRecord && typeof snap.archivedPdfRecord === "object"
    ? snap.archivedPdfRecord
    : null) as Record<string, unknown> | null;

  const candidate =
    (typeof invRecord.pdfUrl === "string" && invRecord.pdfUrl.trim()) ||
    (typeof snap?.pdfUrl === "string" && snap.pdfUrl.trim()) ||
    (typeof snap?.pdfFilePath === "string" && snap.pdfFilePath.trim()) ||
    (typeof snap?.originalPdfPath === "string" && snap.originalPdfPath.trim()) ||
    (typeof storedInfo?.path === "string" && storedInfo.path.trim()) ||
    (typeof storedInfo?.filePath === "string" && storedInfo.filePath.trim()) ||
    (typeof archivedRecord?.path === "string" && archivedRecord.path.trim()) ||
    (typeof archivedRecord?.filePath === "string" && archivedRecord.filePath.trim()) ||
    null;

  return candidate || null;
}

/**
 * Resolves the expected reference SHA-256 checksum for a stored PDF from snapshotData.
 */
export function resolveStoredPdfExpectedChecksum(
  snapshotData: unknown
): string | null {
  if (!snapshotData || typeof snapshotData !== "object") return null;
  const snap = snapshotData as Record<string, unknown>;
  const storedInfo = (snap.storedPdfInfo && typeof snap.storedPdfInfo === "object"
    ? snap.storedPdfInfo
    : null) as Record<string, unknown> | null;
  const archivedRecord = (snap.archivedPdfRecord && typeof snap.archivedPdfRecord === "object"
    ? snap.archivedPdfRecord
    : null) as Record<string, unknown> | null;

  const hash =
    (typeof storedInfo?.sha256 === "string" && storedInfo.sha256.trim()) ||
    (typeof archivedRecord?.sha256 === "string" && archivedRecord.sha256.trim()) ||
    (typeof snap.pdfSha256 === "string" && snap.pdfSha256.trim()) ||
    (typeof snap.pdfChecksum === "string" && snap.pdfChecksum.trim()) ||
    (typeof snap.sha256 === "string" && snap.sha256.trim()) ||
    null;

  return hash || null;
}

export function hasReliableInvoiceDocument(
  invoice: {
    id?: string;
    status?: string;
    netAmount?: number | Prisma.Decimal;
    vatAmount?: number | Prisma.Decimal;
    grossAmount?: number | Prisma.Decimal;
    pdfUrl?: string | null;
    snapshotData?: unknown;
    storedPdfVerified?: boolean;
    storedPdfInfo?: {
      exists?: boolean;
      verified?: boolean;
      sha256?: string;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  },
  options?: {
    fileVerifier?: (path: string) => { exists: boolean; sha256?: string; byteLength?: number };
  }
): boolean {
  const snap =
    invoice.snapshotData && typeof invoice.snapshotData === "object"
      ? (invoice.snapshotData as Record<string, unknown>)
      : null;

  // 1. V2 Invoice: modern frozen V2 invoices are inherently reliable only when containing both pdfItems and items,
  // valid descriptions, and mathematically sound cent totals matching DB amounts.
  if (snap && (snap.calculationVersion === "v2" || snap.isV2 === true)) {
    const hasPdfItems = Array.isArray(snap.pdfItems) && snap.pdfItems.length > 0;
    const hasItems = Array.isArray(snap.items) && snap.items.length > 0;
    if (!hasPdfItems || !hasItems) {
      return false;
    }

    // Every item in pdfItems must have a non-empty description
    for (const it of snap.pdfItems as Record<string, unknown>[]) {
      if (!it || typeof it !== "object" || typeof it.description !== "string" || !it.description.trim()) {
        return false;
      }
    }

    const validatedTotals = validateSnapshotMonetaryTotals(snap);
    if (!validatedTotals) {
      return false;
    }
    const { subtotalCents, taxAmountCents, totalCents } = validatedTotals;

    if (subtotalCents + taxAmountCents !== totalCents) {
      return false;
    }

    // Parity with invoice DB amounts if provided
    if (invoice.netAmount !== undefined && invoice.netAmount !== null) {
      const dbNetCents = Math.round(Number(invoice.netAmount) * 100);
      if (subtotalCents !== dbNetCents) return false;
    }
    if (invoice.vatAmount !== undefined && invoice.vatAmount !== null) {
      const dbVatCents = Math.round(Number(invoice.vatAmount) * 100);
      if (taxAmountCents !== dbVatCents) return false;
    }
    if (invoice.grossAmount !== undefined && invoice.grossAmount !== null) {
      const dbGrossCents = Math.round(Number(invoice.grossAmount) * 100);
      if (totalCents !== dbGrossCents) return false;
    }

    return true;
  }

  // 2. Stored File Candidate: check if a stored PDF exists AND has a verified reference checksum
  const candidatePdfPath = resolveStoredPdfCandidatePath(invoice);

  if (candidatePdfPath) {
    const registeredChecksum = resolveStoredPdfExpectedChecksum(snap);

    if (!registeredChecksum) {
      return false;
    }

    // Check verification status flags on invoice or snapshot
    if (invoice.storedPdfVerified === false) {
      return false;
    }
    const storedInfo = snap?.storedPdfInfo as Record<string, unknown> | undefined;
    if (storedInfo && (storedInfo.exists === false || storedInfo.verified === false)) {
      return false;
    }
    const invStoredInfo = invoice.storedPdfInfo;
    if (invStoredInfo && (invStoredInfo.exists === false || invStoredInfo.verified === false)) {
      return false;
    }
    if ((invoice as Record<string, unknown>).fileMissing === true) {
      return false;
    }
    const snapStoredVerif = snap?.storedPdfVerification as Record<string, unknown> | undefined;
    if (snapStoredVerif && (snapStoredVerif.reliable === false || snapStoredVerif.exists === false)) {
      return false;
    }

    // If options.fileVerifier is provided, verify directly
    if (options?.fileVerifier) {
      const verifResult = options.fileVerifier(candidatePdfPath);
      if (!verifResult.exists) {
        return false;
      }
      if (verifResult.sha256 && verifResult.sha256 !== registeredChecksum) {
        return false;
      }
      return true;
    }

    // When called from the UI without fileVerifier (browser client):
    // A stored file is only considered reliable if explicitly verified by the server (storedPdfVerified === true).
    if (invoice.storedPdfVerified === true) {
      return true;
    }

    // If the stored file is unverified, missing, or rejected by the server, do NOT declare reliable solely from the path.
    // Fall through to evaluate whether a complete frozen snapshot exists as alternative origin.
  }

  // 3. Frozen Snapshot Candidate: requires complete immutable frozen snapshot
  if (!snap) {
    return false;
  }

  const items =
    Array.isArray(snap.items) && snap.items.length > 0
      ? snap.items
      : Array.isArray(snap.pdfItems) && snap.pdfItems.length > 0
      ? snap.pdfItems
      : null;
  if (!items || items.length === 0) {
    return false;
  }

  let calculatedItemsNetCents = 0;
  for (let i = 0; i < items.length; i++) {
    const normalized = normalizeHistoricalItem(items[i], i + 1);
    if (!normalized) return false;
    calculatedItemsNetCents += normalized.amountCents;
  }

  const clientObj =
    snap.client && typeof snap.client === "object"
      ? (snap.client as Record<string, unknown>)
      : null;
  const facility =
    (typeof snap.facilityName === "string" ? snap.facilityName.trim() : "") ||
    (clientObj && typeof clientObj.facilityName === "string" ? clientObj.facilityName.trim() : "");
  const address =
    (typeof snap.address === "string" ? snap.address.trim() : "") ||
    (clientObj && typeof clientObj.address === "string" ? clientObj.address.trim() : "");

  if (!facility || !address) {
    return false;
  }

  // Mandatory Payment Terms (no fabricated default)
  const paymentTerms =
    typeof snap.paymentTermsDays === "number" && !isNaN(snap.paymentTermsDays) && snap.paymentTermsDays > 0
      ? snap.paymentTermsDays
      : typeof clientObj?.paymentTermsDays === "number" &&
        !isNaN(clientObj.paymentTermsDays) &&
        clientObj.paymentTermsDays > 0
      ? clientObj.paymentTermsDays
      : null;

  if (paymentTerms === null) {
    return false;
  }

  // Mandatory monetary totals
  const validatedTotals = validateSnapshotMonetaryTotals(snap);
  if (!validatedTotals) {
    return false;
  }
  const { subtotalCents, taxAmountCents, totalCents } = validatedTotals;

  // Discrepancy between calculated items and subtotal (allow <= 1 cent legacy rounding)
  if (Math.abs(calculatedItemsNetCents - subtotalCents) > 1) {
    return false;
  }

  // Parity with invoice row amounts if provided
  if (invoice.netAmount !== undefined && invoice.netAmount !== null) {
    const dbNetCents = Math.round(Number(invoice.netAmount) * 100);
    if (subtotalCents !== dbNetCents) return false;
  }
  if (invoice.vatAmount !== undefined && invoice.vatAmount !== null) {
    const dbVatCents = Math.round(Number(invoice.vatAmount) * 100);
    if (taxAmountCents !== dbVatCents) return false;
  }
  if (invoice.grossAmount !== undefined && invoice.grossAmount !== null) {
    const dbGrossCents = Math.round(Number(invoice.grossAmount) * 100);
    if (totalCents !== dbGrossCents) return false;
  }

  return true;
}

/**
 * Checks whether a worker has financial/auditable records, either through:
 * 1. Currently active invoiced assignments (assignment.invoiceId !== null)
 * 2. Historical or cancelled invoices whose frozen snapshotData preserves the worker
 */
export async function hasHistoricalInvoiceRecordForWorker(
  workerId: string
): Promise<boolean> {
  // 1. Current active invoiced assignments
  const activeCount = await prisma.assignment.count({
    where: { workerId, invoiceId: { not: null } },
  });
  if (activeCount > 0) return true;

  // 2. Frozen snapshot data across all invoices (including cancelled ones)
  const invoices = await prisma.invoice.findMany({
    where: { snapshotData: { not: Prisma.DbNull } },
    select: { snapshotData: true },
  });

  for (const inv of invoices) {
    if (!inv.snapshotData || typeof inv.snapshotData !== "object") continue;
    const snap = inv.snapshotData as Record<string, unknown>;
    if (
      Array.isArray(snap.historicalWorkerIds) &&
      snap.historicalWorkerIds.includes(workerId)
    ) {
      return true;
    }
    if (
      Array.isArray(snap.items) &&
      snap.items.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).workerId === workerId
      )
    ) {
      return true;
    }
    if (
      Array.isArray(snap.pdfItems) &&
      snap.pdfItems.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).workerId === workerId
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an assignment has financial/auditable records, either through:
 * 1. Current active invoice link (assignment.invoiceId !== null)
 * 2. Historical or cancelled invoices whose frozen snapshotData preserves the assignment
 */
export async function hasHistoricalInvoiceRecordForAssignment(
  assignmentId: string
): Promise<boolean> {
  // 1. Current active invoice link
  const asgn = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { invoiceId: true },
  });
  if (asgn?.invoiceId) return true;

  // 2. Frozen snapshot data across all invoices (including cancelled ones)
  const invoices = await prisma.invoice.findMany({
    where: { snapshotData: { not: Prisma.DbNull } },
    select: { snapshotData: true },
  });

  for (const inv of invoices) {
    if (!inv.snapshotData || typeof inv.snapshotData !== "object") continue;
    const snap = inv.snapshotData as Record<string, unknown>;
    if (
      Array.isArray(snap.historicalAssignmentIds) &&
      snap.historicalAssignmentIds.includes(assignmentId)
    ) {
      return true;
    }
    if (
      Array.isArray(snap.items) &&
      snap.items.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).assignmentId === assignmentId
      )
    ) {
      return true;
    }
    if (
      Array.isArray(snap.pdfItems) &&
      snap.pdfItems.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).assignmentId === assignmentId
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an order has financial/auditable records, either through:
 * 1. Current active invoice links on its assignments (assignment.invoiceId !== null)
 * 2. Historical or cancelled invoices whose frozen snapshotData preserves the order or its assignments
 */
export async function hasHistoricalInvoiceRecordForOrder(
  orderId: string
): Promise<boolean> {
  const invoices = await prisma.invoice.findMany({
    where: { snapshotData: { not: Prisma.DbNull } },
    select: { snapshotData: true },
  });

  for (const inv of invoices) {
    if (!inv.snapshotData || typeof inv.snapshotData !== "object") continue;
    const snap = inv.snapshotData as Record<string, unknown>;
    if (
      Array.isArray(snap.historicalOrderIds) &&
      snap.historicalOrderIds.includes(orderId)
    ) {
      return true;
    }
    if (
      Array.isArray(snap.items) &&
      snap.items.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).orderId === orderId
      )
    ) {
      return true;
    }
    if (
      Array.isArray(snap.pdfItems) &&
      snap.pdfItems.some(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).orderId === orderId
      )
    ) {
      return true;
    }
  }

  return false;
}
