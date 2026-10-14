import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, prepareV2InvoiceReview, reviewPdfData, generateInvoicePdf } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prepareV2InvoiceReview: vi.fn(),
  reviewPdfData: vi.fn(() => ({ draft: true })),
  generateInvoicePdf: vi.fn(async () => Buffer.from("%PDF-1.4\nmock")),
}));

vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("@/lib/invoice-v2-review", () => ({ prepareV2InvoiceReview, reviewPdfData }));
vi.mock("@/lib/pdf/invoice", () => ({ generateInvoicePdf }));

import { POST } from "./route";

const hash = "a".repeat(64);
const draft = {
  assignmentIds: ["shift-1"],
  clientInfo: { facilityName: "Testeinrichtung" },
  periodDisplay: "09/2026",
  pdfItems: [{ pos: 1, description: "Dienst", hours: "2,00", rate: "40,00", amount: "80,00" }],
  provenance: { assignments: [{ assignmentId: "shift-1", workerName: "Test", shiftDate: "2026-09-01", allocatedBreakStart: "12:00", allocatedBreakEnd: "12:30", breakMinutes: 30 }] },
  snapshotData: { subtotal: "80,00", taxAmount: "15,20", total: "95,20" },
};

function request(accept: string, expectedDraftHash?: string) {
  return new Request("http://localhost/api/invoices/v2-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: accept },
    body: JSON.stringify({ assignmentIds: ["shift-1"], expectedDraftHash }),
  });
}

describe("V2 invoice preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prepareV2InvoiceReview.mockResolvedValue({ ok: true, hash, draft });
  });

  it("returns review details and PDF from one calculation", async () => {
    const response = await POST(request("application/json") as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.draftHash).toBe(hash);
    expect(body.total).toBe("95,20");
    expect(Buffer.from(body.pdfBase64, "base64").toString()).toContain("%PDF-1.4");
    expect(prepareV2InvoiceReview).toHaveBeenCalledTimes(1);
    expect(generateInvoicePdf).toHaveBeenCalledTimes(1);
  });

  it("retains hash validation for the PDF-only endpoint", async () => {
    const response = await POST(request("application/pdf") as never);
    expect(response.status).toBe(400);
    expect(prepareV2InvoiceReview).not.toHaveBeenCalled();
  });
});
