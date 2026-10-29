import { format } from "@/lib/date-utils";
import { formatAmount, validateSnapshotMonetaryTotals } from "@/lib/invoicing";
import type { InvoicePdfData } from "@/lib/pdf/invoice";

type CancelledInvoice = {
  invoiceNumber: string;
  status: string;
  date: Date;
  netAmount?: number;
  vatAmount?: number;
  grossAmount: number;
  snapshotData: unknown;
  updatedAt?: Date;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Stornorechnung nicht verfügbar: ${field} fehlt im ursprünglichen Rechnungssnapshot.`);
  }
  return value.trim();
}

/** Reverse the amounts actually frozen on the issued invoice, never current prices or shifts. */
export function buildStornoInvoiceData(invoice: CancelledInvoice, issuedAt: Date): InvoicePdfData {
  if (invoice.status !== "cancelled") {
    throw new Error("Nur eine bereits stornierte Rechnung kann einen Stornobeleg haben.");
  }
  const snapshot = invoice.snapshotData;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Stornorechnung nicht verfügbar: ursprünglicher Rechnungssnapshot fehlt.");
  }
  const s = snapshot as Record<string, unknown>;
  const history = s.cancellationHistory;
  const rawCancelledAt = history && typeof history === "object"
    ? (history as Record<string, unknown>).cancelledAt
    : null;
  const cancelledAt =
    typeof rawCancelledAt === "string" && Number.isFinite(Date.parse(rawCancelledAt))
      ? rawCancelledAt
      : invoice.updatedAt instanceof Date && Number.isFinite(invoice.updatedAt.getTime())
        ? invoice.updatedAt.toISOString()
        : typeof s.cancelledAt === "string" && Number.isFinite(Date.parse(s.cancelledAt))
          ? s.cancelledAt
          : null;
  if (!cancelledAt || !Number.isFinite(issuedAt.getTime())) {
    throw new Error("Stornorechnung nicht verfügbar: protokolliertes Stornodatum fehlt.");
  }

  let totals = validateSnapshotMonetaryTotals(s);
  if (!totals && typeof invoice.grossAmount === "number" && invoice.grossAmount > 0) {
    const grossCents = Math.round(invoice.grossAmount * 100);
    const netCents = typeof invoice.netAmount === "number" ? Math.round(invoice.netAmount * 100) : 0;
    const vatCents = typeof invoice.vatAmount === "number" ? Math.round(invoice.vatAmount * 100) : 0;
    if (netCents > 0 && vatCents >= 0 && netCents + vatCents === grossCents) {
      totals = {
        subtotalCents: netCents,
        taxAmountCents: vatCents,
        totalCents: grossCents,
        subtotalDisplay: (netCents / 100).toFixed(2),
        taxAmountDisplay: (vatCents / 100).toFixed(2),
        totalDisplay: (grossCents / 100).toFixed(2),
      };
    }
  }

  if (!totals || totals.subtotalCents <= 0 || totals.taxAmountCents < 0 ||
      totals.subtotalCents + totals.taxAmountCents !== totals.totalCents ||
      totals.totalCents !== Math.round(invoice.grossAmount * 100)) {
    throw new Error("Stornorechnung nicht verfügbar: die ursprünglichen Rechnungsbeträge sind unvollständig oder widersprüchlich. Bitte das Originaldokument mit der Buchhaltung abgleichen.");
  }
  const declaredRate = typeof s.taxRatePercent === "number" ? s.taxRatePercent : null;
  const matchingRate = [19, 7, 0].find(rate =>
    Math.round(totals.subtotalCents * rate / 100) === totals.taxAmountCents
  );
  const taxRatePercent = declaredRate ?? matchingRate;
  if (taxRatePercent === undefined || taxRatePercent === null ||
      Math.round(totals.subtotalCents * taxRatePercent / 100) !== totals.taxAmountCents) {
    throw new Error("Stornorechnung nicht verfügbar: der ursprüngliche Umsatzsteuersatz ist nicht eindeutig belegbar.");
  }

  const clientName = requiredText(s.facilityName, "Empfängername");
  const clientAddress = requiredText(s.address, "Empfängeranschrift");
  const clientId = requiredText(s.internalNumber || s.shortCode, "Kundennummer");
  const originalNumber = requiredText(invoice.invoiceNumber, "Rechnungsnummer");
  const stornoNumber = `ST-${originalNumber}`;

  return {
    cancellation: {
      originalInvoiceNumber: originalNumber,
      originalInvoiceDate: format(invoice.date, "dd.MM.yyyy"),
    },
    invoiceNumber: stornoNumber,
    date: format(issuedAt, "dd.MM.yyyy"),
    clientId,
    clientName,
    billingInfo: typeof s.billingInfo === "string" && s.billingInfo.trim() ? s.billingInfo : null,
    clientAddress,
    periodStart: typeof s.periodStart === "string" ? s.periodStart : "",
    periodEnd: typeof s.periodEnd === "string" ? s.periodEnd : "",
    items: [{
      pos: 1,
      description: `Vollständige Stornierung der Rechnung ${originalNumber} vom ${format(invoice.date, "dd.MM.yyyy")}`,
      hours: "-1,00",
      rate: totals.subtotalDisplay.replace(/\s*€$/, "").trim(),
      amount: formatAmount(-totals.subtotalCents / 100),
    }],
    subtotal: formatAmount(-totals.subtotalCents / 100),
    taxAmount: formatAmount(-totals.taxAmountCents / 100),
    taxRatePercent,
    total: formatAmount(-totals.totalCents / 100),
    paymentTermsDays: 0,
  };
}
