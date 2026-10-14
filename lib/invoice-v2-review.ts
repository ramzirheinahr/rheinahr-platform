import { prepareV2InvoiceDraft } from "@/lib/invoice-v2-draft-service";
import { computeV2DraftHash } from "@/lib/invoice-v2-issuance-service";
import type { InvoicePdfData } from "@/lib/pdf/invoice";

export async function prepareV2InvoiceReview(
  assignmentIds: string[],
  breakStartByAssignment?: Record<string, string>
) {
  const draft = await prepareV2InvoiceDraft({ assignmentIds, breakStartByAssignment });
  if (draft.status !== "resolved") {
    return { ok: false as const, code: draft.code, message: draft.message, diagnostics: draft.diagnostics };
  }
  return {
    ok: true as const,
    draft,
    hash: computeV2DraftHash(draft),
  };
}

export function reviewPdfData(
  draft: Extract<Awaited<ReturnType<typeof prepareV2InvoiceDraft>>, { status: "resolved" }>
): InvoicePdfData {
  const client = draft.clientInfo;
  const date = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(new Date());
  return {
    draft: true,
    invoiceNumber: "",
    date,
    clientId: client.internalNumber || client.shortCode || draft.clientId.slice(0, 8),
    clientName: client.facilityName,
    billingInfo: client.billingInfo || null,
    clientAddress: client.address || "",
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    items: draft.pdfItems,
    subtotal: draft.snapshotData.subtotal,
    taxAmount: draft.snapshotData.taxAmount,
    total: draft.snapshotData.total,
    paymentTermsDays: client.paymentTermsDays,
  };
}
