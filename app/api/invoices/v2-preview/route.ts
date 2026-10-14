import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prepareV2InvoiceReview, reviewPdfData } from "@/lib/invoice-v2-review";
import { generateInvoicePdf } from "@/lib/pdf/invoice";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireRole("de", "admin");
  } catch {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: { assignmentIds?: unknown; expectedDraftHash?: unknown; breakStartByAssignment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const ids = body.assignmentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((id) => typeof id !== "string" || !id)) {
    return NextResponse.json({ error: "INVALID_ASSIGNMENTS" }, { status: 400 });
  }
  const wantsJson = req.headers.get("Accept")?.includes("application/json") ?? false;
  if ((!wantsJson || body.expectedDraftHash !== undefined) &&
      (typeof body.expectedDraftHash !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedDraftHash))) {
    return NextResponse.json({ error: "REVIEW_REQUIRED" }, { status: 400 });
  }

  const breaks = body.breakStartByAssignment;
  if (breaks !== undefined && (
    !breaks || typeof breaks !== "object" || Array.isArray(breaks) ||
    Object.keys(breaks).length > ids.length ||
    Object.values(breaks).some((value) => typeof value !== "string")
  )) {
    return NextResponse.json({ error: "INVALID_BREAK_TIMES" }, { status: 400 });
  }
  const result = await prepareV2InvoiceReview(ids, breaks as Record<string, string> | undefined);
  if (!result.ok) {
    return NextResponse.json({ error: result.code, message: result.message, diagnostics: result.diagnostics }, { status: 422 });
  }
  if (body.expectedDraftHash && result.hash !== body.expectedDraftHash) {
    return NextResponse.json({ error: "STALE_DRAFT_DETECTED" }, { status: 409 });
  }

  const pdf = await generateInvoicePdf(reviewPdfData(result.draft));
  if (wantsJson) {
    const draft = result.draft;
    return NextResponse.json({
      ok: true,
      assignmentIds: draft.assignmentIds,
      draftHash: result.hash,
      clientName: draft.clientInfo.facilityName,
      period: draft.periodDisplay,
      items: draft.pdfItems,
      breakAllocations: draft.provenance.assignments
        .filter((assignment) => assignment.allocatedBreakStart && assignment.allocatedBreakEnd)
        .map((assignment) => ({
          assignmentId: assignment.assignmentId,
          workerName: assignment.workerName,
          shiftDate: assignment.shiftDate,
          start: assignment.allocatedBreakStart!,
          end: assignment.allocatedBreakEnd!,
          minutes: assignment.breakMinutes,
        })),
      subtotal: draft.snapshotData.subtotal,
      taxAmount: draft.snapshotData.taxAmount,
      total: draft.snapshotData.total,
      pdfBase64: Buffer.from(pdf).toString("base64"),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Rechnungsentwurf.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
