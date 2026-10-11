/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach } from "vitest";
import zlib from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config/company", () => ({
  getCompanyConfig: async () => ({
    name: "RheinAhr Dienstleistungen GmbH",
    street: "Musterstr. 12",
    city: "53474 Bad Neuenahr-Ahrweiler",
    phone: "02641 123456",
    email: "info@rheinahr.de",
    website: "www.rheinahr.de",
    registryCourt: "Koblenz",
    hrb: "HRB 12345",
    taxId: "01/234/56789",
    vatId: "DE123456789",
    ceo: "Geschäftsführer",
    bankName: "Volksbank",
    iban: "DE00000000000000000000",
    bic: "GENODEF1XXX",
    logoUrl: "/logo.png",
  }),
}));

import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import { GET as getBulkPdfRoute } from "@/app/api/invoices/bulk-pdf/route";
import { GET as getConfirmationDocumentRoute } from "@/app/api/confirmations/[assignmentId]/document/route";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import {
  doIntervalsOverlap,
  previewClientHourlyRate,
  createAndFreezeClientHourlyRate,
  updateClientHourlyRate,
  deleteClientHourlyRate,
} from "@/lib/client-price-admin-service";
import {
  addConfirmationEvidence,
  createOrUpdateHoursCorrectionRequest,
  approveHoursCorrectionRequest,
  getAssignmentEffectiveWorkHours,
  ConfirmationEvidenceError,
} from "@/lib/confirmation-evidence-service";
import {
  buildInvoicingWhereClause,
  getInvoiceFacilityName,
  hasReliableInvoiceDocument,
} from "@/lib/invoicing";
import { detectShiftOverlaps } from "@/lib/shift-overlap-engine";
import { getStundennachweisData } from "@/lib/reports-data";
import { defaultFileVerifier, getAllowedInvoiceStorageRoots } from "@/lib/invoice-v2-refresh-service";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";

// Mocks
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
  resolveClientId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoiceRevision: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    assignment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    confirmationDocument: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    workHoursCorrectionRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    clientContract: {
      findUnique: vi.fn(),
    },
    clientHourlyRateVersion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    worker: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
    leaveDay: {
      findMany: vi.fn(),
    },
    workerHoursAdjustment: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (cb: any) => cb(prisma)),
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        download: vi.fn().mockResolvedValue({
          data: {
            arrayBuffer: async () => Buffer.from("%PDF-1.4 mock streamed document bytes"),
          },
          error: null,
        }),
      })),
    },
  })),
}));

import { getCurrentUser, roleSatisfies, resolveClientId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Extracts and decompresses text streams from PDF bytes to verify rendered strings,
 * including decoding PDF literal hex strings (<...>) emitted by font engines.
 */
function extractTextFromPdf(pdfBytes: Uint8Array | Buffer): string {
  const buf = Buffer.from(pdfBytes);
  let text = buf.toString("latin1");
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(buf.toString("latin1"))) !== null) {
    try {
      const decompressed = zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      text += "\n" + decompressed;

      // Decode hex-encoded text chunks `<[0-9a-fA-F]+>` into readable characters
      const hexRegex = /<([0-9a-fA-F]+)>/g;
      let hexMatch: RegExpExecArray | null;
      let decodedFromHex = "";
      while ((hexMatch = hexRegex.exec(decompressed)) !== null) {
        decodedFromHex += Buffer.from(hexMatch[1], "hex").toString("latin1");
      }
      text += "\n" + decodedFromHex;
    } catch {
      // Skip non-flate streams
    }
  }
  return text;
}

describe("Phase 07c - Comprehensive Integrated Operational Acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
  });

  // =========================================================================
  // SECTION 1: DATABASE CONCURRENCY & LOGICAL GUARDS (APPLICATION-LEVEL)
  // =========================================================================
  describe("1. Application-Level Database Concurrency & Invariant Guards", () => {
    it("1.1 Optimistic concurrency version token guard on approvals (Application-level version token enforcement; physical PostgreSQL concurrent transaction races remain UNEXECUTED_STAGING_GATE_OPEN)", async () => {
      // NOTE ON SCOPE: This test validates the application-level optimistic concurrency version token check
      // (`expectedEffectiveVersion` comparison and atomic conditional `updateMany`). Physical concurrent multi-connection
      // PostgreSQL transactions under load remain unexecuted and declared in UNEXECUTED_STAGING_GATE_OPEN.
      let requestStatus = "proposed";

      const assignmentRecord = {
        id: "asg-conc-1",
        order: {
          id: "ord-conc-1",
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 0,
        },
        serviceConfirmation: {
          id: "sc-asg-1",
          method: "electronic",
          hoursWorked: 8.0,
          signatureData: "sig-base",
          signerName: "Leitung",
          confirmedAt: new Date("2026-10-01T16:00:00Z"),
          documentUrl: null,
        },
      };

      const correctionRequestRecord = {
        id: "req-conc-1",
        assignmentId: "asg-conc-1",
        baseVersion: "",
        status: "proposed",
        revision: 1,
        proposedHoursWorked: 7.0,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 0,
        requestedAt: new Date("2026-10-02T10:00:00Z"),
        document: {
          id: "doc-conc-1",
          assignmentId: "asg-conc-1",
        },
        assignment: assignmentRecord,
      };

      // Mock an atomic database state machine for Prisma transaction
      const txPrisma = {
        assignment: {
          findUnique: vi.fn().mockResolvedValue(assignmentRecord),
        },
        workHoursCorrectionRequest: {
          findUnique: vi.fn().mockImplementation(async () => ({
            ...correctionRequestRecord,
            status: requestStatus,
          })),
          findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
            ...correctionRequestRecord,
            status: requestStatus,
          })),
          findFirst: vi.fn().mockImplementation(async (query: any) => {
            if (query?.where?.status === "approved") {
              if (requestStatus === "approved") {
                return {
                  id: "req-conc-1",
                  status: "approved",
                  proposedHoursWorked: 7.0,
                  proposedStartTime: "08:00",
                  proposedEndTime: "15:00",
                  proposedBreakMinutes: 0,
                  revision: 1,
                  decidedAt: new Date(),
                  requestedAt: correctionRequestRecord.requestedAt,
                };
              }
              return null;
            }
            return null;
          }),
          updateMany: vi.fn().mockImplementation(async (query: any) => {
            if (query.where.id === "req-conc-1" && query.where.status === "proposed" && requestStatus === "proposed") {
              requestStatus = "approved";
              return { count: 1 };
            }
            return { count: 0 };
          }),
          update: vi.fn().mockResolvedValue({ id: "req-conc-1", status: "approved" }),
        },
      };

      (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(txPrisma));

      // Resolve true initial version token from effective work hours read model
      const initialEffective = await getAssignmentEffectiveWorkHours("asg-conc-1", txPrisma as any);
      const validInitialVersion = initialEffective.effectiveVersion;
      correctionRequestRecord.baseVersion = validInitialVersion;

      const adminUser = { id: "admin-1", role: "admin" };

      // Two concurrent calls presenting the same initial version token
      const call1 = approveHoursCorrectionRequest({
        correctionRequestId: "req-conc-1",
        expectedEffectiveVersion: validInitialVersion,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:00",
        effectiveBreakMinutes: 0,
        currentUser: adminUser,
      });

      const call2 = approveHoursCorrectionRequest({
        correctionRequestId: "req-conc-1",
        expectedEffectiveVersion: validInitialVersion,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:00",
        effectiveBreakMinutes: 0,
        currentUser: adminUser,
      });

      const [res1, res2] = await Promise.allSettled([call1, call2]);

      // Exactly one succeeds, the other fails with a concurrency conflict
      const succeeded = [res1, res2].filter((r) => r.status === "fulfilled");
      const failed = [res1, res2].filter((r) => r.status === "rejected");

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const rejectionError = (failed[0] as PromiseRejectedResult).reason;
      expect(rejectionError).toBeInstanceOf(ConfirmationEvidenceError);
      expect(["CONCURRENT_MODIFICATION_CONFLICT", "CONCURRENT_DECISION_CONFLICT", "ALREADY_DECIDED"]).toContain(
        rejectionError.code
      );

      // Restore default transaction mock for remaining tests
      (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
    });

    it("1.2 Hourly rate version interval overlap: Application-level date interval validation (Physical PostgreSQL EXCLUDE constraint remains UNEXECUTED_STAGING_GATE_OPEN)", async () => {
      // NOTE ON SCOPE: This validates application-level interval overlap rejection logic in `doIntervalsOverlap`
      // and administrative service ingestion. Physical PostgreSQL `EXCLUDE USING gist` constraints remain
      // declared in UNEXECUTED_STAGING_GATE_OPEN.
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-07-01", "2026-12-31")).toBe(false);
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-06-30", "2026-12-31")).toBe(true);
      expect(doIntervalsOverlap("2026-03-01", "2026-04-30", "2026-01-01", "2026-12-31")).toBe(true);

      const mockPrisma = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin", active: true }),
        },
        client: {
          findUnique: vi.fn().mockResolvedValue({
            id: "c-overlap-1",
            frameworkAgreementSignedAt: new Date("2026-01-01"),
            frameworkAgreementUrl: "https://example.com/framework.pdf",
          }),
        },
        clientHourlyRateVersion: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "rate-existing-1",
              rateVersion: 1,
              effectiveFrom: new Date("2026-01-01T00:00:00Z"),
              effectiveTo: new Date("2026-06-30T23:59:59Z"),
            },
          ]),
        },
      } as any;

      const overlapRes = await previewClientHourlyRate({
        prisma: mockPrisma,
        input: {
          clientId: "c-overlap-1",
          qualification: "Pflegefachkraft",
          hourlyRateInCents: 4500,
          effectiveFrom: "2026-06-15",
          effectiveTo: "2026-12-31",
          sourceType: "framework_agreement",
          sourceReference: "Rahmenvertrag 2026",
          sourceDocumentUrl: "https://example.com/framework.pdf",
          verifyingUserId: "admin-1",
        },
        actorUserId: "admin-1",
      });

      expect(overlapRes.success).toBe(false);
      if (!overlapRes.success) {
        expect(overlapRes.code).toBe("OVERLAPPING_VALIDITY_INTERVAL");
      }
    });

    it("1.3 Frozen rate version immutability: Application-level service guard rejecting modification/deletion of frozen rates (Physical PostgreSQL RESTRICT/triggers remain UNEXECUTED_STAGING_GATE_OPEN)", async () => {
      // NOTE ON SCOPE: This validates application-level service guards preventing mutation of rates referenced by invoices.
      // Database foreign key RESTRICT constraints and database triggers remain declared in UNEXECUTED_STAGING_GATE_OPEN.
      const mockPrisma = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin", active: true }),
        },
        clientHourlyRateVersion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "rate-frozen-1",
            isFrozen: true,
            _count: { invoiceRevisions: 1 },
          }),
        },
      };

      const updateRes = await updateClientHourlyRate({
        prisma: mockPrisma as any,
        rateId: "rate-frozen-1",
        actorUserId: "admin-1",
      });
      expect(updateRes.success).toBe(false);
      if (!updateRes.success) {
        expect(updateRes.code).toBe("FROZEN_RECORD_IMMUTABLE");
      }

      const deleteRes = await deleteClientHourlyRate({
        prisma: mockPrisma as any,
        rateId: "rate-frozen-1",
        actorUserId: "admin-1",
      });
      expect(deleteRes.success).toBe(false);
      if (!deleteRes.success) {
        expect(deleteRes.code).toBe("FROZEN_RECORD_IMMUTABLE");
      }
    });

    it("1.4 Zero mutation of historical invoices on reading PDF or fetching documents", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-1", role: "admin" });

      const readInvoice = {
        id: "inv-read-1",
        invoiceNumber: "RE-READ-01",
        status: "paid",
        date: new Date("2026-10-01"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        client: {
          id: "c-1",
          facilityName: "Facility Alpha",
          shortCode: "FA",
          internalNumber: "CL-01",
          address: "Musterstr. 1, 53474 Bad Neuenahr",
          billingEmail: "alpha@example.com",
          billingInfo: null,
          paymentTermsDays: 14,
          userId: "u-1",
        },
        assignments: [],
        snapshotData: {
          calculationVersion: "v2",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          items: [{ pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 }],
          pdfItems: [{ pos: 1, description: "Fachkraft", hours: "3,00", rate: "5,68", amount: "17,04 €" }],
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(readInvoice);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost/api/invoices/inv-read-1/pdf"),
        { params: Promise.resolve({ id: "inv-read-1" }) }
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");

      // Strict check: zero database mutations during read/stream operation
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
      expect(prisma.assignment.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SECTION 2: FINANCIAL PRECISION, REAL PDF TEXT EXTRACTION & BULK PDF
  // =========================================================================
  describe("2. Financial Paths, Benchmark Precision & Real PDF Content", () => {
    it("2.1 Benchmark precision & PDF text stream extraction: 3 hours @ 5,68 €/h = 17,04 € net, 3,24 € VAT, 20,28 € gross without double currency or 17,03 € drift", async () => {
      const benchmarkInvoice = {
        id: "inv-benchmark",
        invoiceNumber: "RE-2026-BENCH",
        date: new Date("2026-10-01"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: {
          calculationVersion: "v2",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          items: [
            { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
          ],
          pdfItems: [
            { pos: 1, description: "Pflegehelfer", hours: "3,00", rate: "5,68", amount: "17,04 €" },
          ],
        },
      };

      const mockClient = {
        id: "client-bench",
        facilityName: "Altenheim Sankt Martin",
        internalNumber: "CL-01",
        shortCode: "ASM",
        address: "Musterstr. 1, 53474 Bad Neuenahr",
        billingEmail: "rechnung@example.com",
        billingInfo: null,
        paymentTermsDays: 14,
      };

      const pdfData = buildInvoicePdfData(benchmarkInvoice as any, mockClient as any, []);

      expect(pdfData.subtotal).toBe("17,04 €");
      expect(pdfData.taxAmount).toBe("3,24 €");
      expect(pdfData.total).toBe("20,28 €");

      expect(pdfData.subtotal).not.toContain("€ €");
      expect(pdfData.taxAmount).not.toContain("€ €");
      expect(pdfData.total).not.toContain("€ €");
      expect(pdfData.subtotal).not.toBe("17,03 €");

      expect(pdfData.items).toHaveLength(1);
      expect(pdfData.items[0].hours).toBe("3,00");
      expect(pdfData.items[0].rate).toBe("5,68");
      expect(pdfData.items[0].amount).toBe("17,04 €");

      // Generate REAL PDF bytes with @react-pdf/renderer and extract text from uncompressed streams
      const pdfBuffer = await generateInvoicePdf(pdfData);
      expect(pdfBuffer.subarray(0, 4).toString()).toBe("%PDF");

      const extractedPdfText = extractTextFromPdf(pdfBuffer);

      // Verify that exact financial numbers are present in the PDF text stream
      expect(extractedPdfText).toContain("17,04");
      expect(extractedPdfText).toContain("3,24");
      expect(extractedPdfText).toContain("20,28");
      expect(extractedPdfText).toContain("3,00");
      expect(extractedPdfText).toContain("5,68");

      // Verify zero drift
      expect(extractedPdfText).not.toContain("17,03");
      expect(extractedPdfText).not.toContain("€ €");
    });

    it("2.2 Bulk PDF combines active invoices, verifies text streams, and excludes cancelled invoices with fail-closed guard", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-1", role: "admin" });

      const activeV2Invoice = {
        id: "inv-active-v2",
        invoiceNumber: "RE-2026-V2-01",
        status: "unpaid",
        date: new Date("2026-10-05"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        client: {
          id: "c-1",
          facilityName: "Facility Alpha",
          shortCode: "FA",
          internalNumber: "CL-01",
          address: "Musterstr. 1, 53474 Bad Neuenahr",
          billingEmail: "alpha@example.com",
          billingInfo: null,
          paymentTermsDays: 14,
          userId: "u-1",
        },
        assignments: [],
        snapshotData: {
          calculationVersion: "v2",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          items: [{ pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 }],
          pdfItems: [{ pos: 1, description: "Fachkraft", hours: "3,00", rate: "5,68", amount: "17,04 €" }],
        },
      };

      const cancelledInvoice = {
        id: "inv-cancelled-01",
        invoiceNumber: "RE-2026-CANC-999",
        status: "cancelled",
        date: new Date("2026-10-06"),
        netAmount: 50.0,
        vatAmount: 9.5,
        grossAmount: 59.5,
        client: { id: "c-1", facilityName: "Facility Alpha", userId: "u-1" },
        assignments: [],
        snapshotData: null,
      };

      (prisma.invoice.findMany as any).mockResolvedValue([activeV2Invoice, cancelledInvoice]);

      const res = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const bytes = await res.arrayBuffer();
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThan(0);

      // Decompress and verify bulk PDF text stream
      const bulkText = extractTextFromPdf(Buffer.from(bytes));
      expect(bulkText).toContain("17,04");
      expect(bulkText).toContain("3,24");
      expect(bulkText).toContain("20,28");
      expect(bulkText).not.toContain("RE-2026-CANC-999"); // Cancelled invoice strictly excluded from PDF

      // Fail-closed guard: missing or corrupted snapshot fails closed with 422
      const corruptedInvoice = {
        ...activeV2Invoice,
        id: "inv-corrupt",
        invoiceNumber: "RE-CORRUPT",
        snapshotData: { calculationVersion: "v2" }, // Missing required items
      };
      (prisma.invoice.findMany as any).mockResolvedValue([corruptedInvoice]);

      const corruptRes = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
      );
      expect(corruptRes.status).toBe(422);
    });

    it("2.3 Storage directory containment: strictly excludes public web root from allowed storage roots", () => {
      const allowedRoots = getAllowedInvoiceStorageRoots();
      expect(allowedRoots.length).toBeGreaterThan(0);

      // Verify that none of the allowed storage roots reside under public/
      for (const root of allowedRoots) {
        expect(root).not.toContain(path.resolve(process.cwd(), "public"));
      }

      // Verify defaultFileVerifier rejects non-existent or dangerous files
      const nonExistent = defaultFileVerifier("/non/existent/path.pdf");
      expect(nonExistent.exists).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 3: THE SIX MANAGEMENT REQUESTS (PRODUCTION SERVICE PATHS)
  // =========================================================================
  describe("3. Six Management Requests Production Service Paths", () => {
    it("Request 1: Cancelled invoices query segregation, document reliability check, and facility name fallback", () => {
      const from = new Date("2026-10-01T00:00:00Z");
      const to = new Date("2026-10-31T23:59:59Z");

      // 1. Production query builder strictly segregates cancelled invoices
      const whereClause = buildInvoicingWhereClause({ from, to });
      expect(whereClause.OR).toBeDefined();

      const branches = whereClause.OR as Array<Record<string, unknown>>;
      const cancelledBranch = branches.find((b) => b.status === "cancelled");
      expect(cancelledBranch).toBeDefined();
      expect(cancelledBranch).toEqual({
        status: "cancelled",
        date: { gte: from, lte: to },
      });

      const regularBranch = branches.find(
        (b) => typeof b.status === "object" && (b.status as Record<string, unknown>).not === "cancelled"
      );
      expect(regularBranch).toBeDefined();

      // 2. Document reliability check distinguishes reliable copy vs noReliableCopy
      const cancelledWithSnapshot = {
        id: "inv-c-1",
        status: "cancelled",
        client: { facilityName: "Seniorenheim Live Name" },
        snapshotData: {
          facilityName: "Seniorenheim Frozen Name",
          pdfItems: [{ pos: 1, description: "Pflegekraft" }],
        },
      };

      const cancelledWithoutSnapshot = {
        id: "inv-c-2",
        status: "cancelled",
        client: { facilityName: "Seniorenheim Live Name" },
        snapshotData: null,
      };

      expect(hasReliableInvoiceDocument(cancelledWithSnapshot)).toBe(true);
      expect(hasReliableInvoiceDocument(cancelledWithoutSnapshot)).toBe(false);

      // 3. Name resolution falls back to frozen snapshot facility name
      expect(getInvoiceFacilityName(cancelledWithSnapshot)).toBe("Seniorenheim Frozen Name");
      expect(getInvoiceFacilityName(cancelledWithoutSnapshot)).toBe("Seniorenheim Live Name");
    });

    it("Request 2: Timesheet upload multi-source support and role-based permissions", async () => {
      const dummyPdfBytes = Buffer.from("%PDF-1.4 mock valid test bytes");

      const mockAssignment = {
        id: "asg-upload-1",
        order: {
          id: "ord-1",
          clientId: "client-1",
          shiftDate: new Date("2026-10-10"),
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
          client: { id: "client-1", userId: "u-client-1", facilityName: "Klinik" },
        },
        worker: { id: "worker-1", userId: "u-worker-1", fullName: "Hans Müller" },
        serviceConfirmation: null,
      };

      (prisma.assignment.findUnique as any).mockResolvedValue(mockAssignment);
      (prisma.confirmationDocument.findFirst as any).mockResolvedValue(null);
      (prisma.confirmationDocument.create as any).mockResolvedValue({
        id: "doc-new-1",
        assignmentId: "asg-upload-1",
        sourceType: "manual_upload",
      });

      // 1. Worker uploads timesheet for their own assignment: SUCCEEDS
      const workerUser = { id: "u-worker-1", role: "worker" };
      const workerRes = await addConfirmationEvidence({
        assignmentId: "asg-upload-1",
        sourceType: "manual_upload",
        file: {
          buffer: dummyPdfBytes,
          fileName: "Stundennachweis_Hans.pdf",
          mimeType: "application/pdf",
          sizeBytes: dummyPdfBytes.length,
        },
        currentUser: workerUser,
      });
      expect(workerRes.document).toBeDefined();

      // 2. Foreign worker uploads timesheet for another worker's assignment: FORBIDDEN
      const foreignWorker = { id: "u-worker-other", role: "worker" };
      await expect(
        addConfirmationEvidence({
          assignmentId: "asg-upload-1",
          sourceType: "manual_upload",
          file: {
            buffer: dummyPdfBytes,
            fileName: "Stundennachweis_Other.pdf",
            mimeType: "application/pdf",
            sizeBytes: dummyPdfBytes.length,
          },
          currentUser: foreignWorker,
        })
      ).rejects.toThrowError(/FORBIDDEN_ASSIGNMENT_ACCESS/);

      // 3. Admin uploads manual timesheet: SUCCEEDS with admin role
      const adminUser = { id: "admin-1", role: "admin" };
      const adminRes = await addConfirmationEvidence({
        assignmentId: "asg-upload-1",
        sourceType: "manual_upload",
        file: {
          buffer: dummyPdfBytes,
          fileName: "Manual_Scan.pdf",
          mimeType: "application/pdf",
          sizeBytes: dummyPdfBytes.length,
        },
        currentUser: adminUser,
      });
      expect(adminRes.document).toBeDefined();

      // 4. Invalid MIME type (e.g. text/html): REJECTED
      await expect(
        addConfirmationEvidence({
          assignmentId: "asg-upload-1",
          sourceType: "manual_upload",
          file: {
            buffer: Buffer.from("<html>malicious</html>"),
            fileName: "script.html",
            mimeType: "text/html",
            sizeBytes: 25,
          },
          currentUser: adminUser,
        })
      ).rejects.toThrowError(/UNSUPPORTED_MIME_TYPE/);
    });

    it("Request 3: Hours correction workflow: executes request and approval, updates effective hours, and preserves electronic original", async () => {
      const assignmentId = "asg-workflow-1";

      const assignmentState = {
        id: assignmentId,
        order: {
          id: "ord-wf-1",
          clientId: "client-wf-1",
          startTime: "08:00",
          endTime: "16:30",
          breakMinutes: 30,
          client: {
            id: "client-wf-1",
            userId: "u-client-1",
            facilityName: "Test Facility",
          },
        },
        worker: {
          id: "worker-wf-1",
          userId: "u-worker-1",
          fullName: "Max Mustermann",
        },
        serviceConfirmation: {
          id: "sc-orig-1",
          method: "electronic",
          hoursWorked: 8.0,
          signatureData: "data:image/png;base64,original_electronic_sig",
          signerName: "Fr. Schmidt (Original)",
          confirmedAt: new Date("2026-10-01T16:30:00Z"),
          documentUrl: null,
        },
      };

      const docState = {
        id: "doc-wf-1",
        assignmentId,
        sourceType: "manual_upload",
        storagePath: "signed-confirmations/client-wf-1/asg-workflow-1/doc.pdf",
        fileName: "Korrektur_Nachweis.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
      };

      // In-memory store for work hours correction requests to support stateful transitions
      const dbCorrectionRequests: any[] = [];

      (prisma.assignment.findUnique as any).mockImplementation(async () => assignmentState);
      (prisma.confirmationDocument.findUnique as any).mockImplementation(async (query: any) => {
        if (query?.where?.id === docState.id) return docState;
        return null;
      });

      (prisma.workHoursCorrectionRequest.findFirst as any).mockImplementation(async (query: any) => {
        const where = query?.where || {};
        const matches = dbCorrectionRequests.filter((req) => {
          if (where.assignmentId && req.assignmentId !== where.assignmentId) return false;
          if (where.status && req.status !== where.status) return false;
          if (where.id?.not && req.id === where.id.not) return false;
          if (where.baseVersion && req.baseVersion !== where.baseVersion) return false;
          if (where.decidedAt?.gt && !(req.decidedAt > where.decidedAt.gt)) return false;
          return true;
        });
        if (matches.length === 0) return null;
        if (query?.orderBy) {
          matches.sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0));
        }
        return matches[0] || null;
      });

      (prisma.workHoursCorrectionRequest.findUnique as any).mockImplementation(async (query: any) => {
        const id = query?.where?.id;
        const found = dbCorrectionRequests.find((req) => req.id === id);
        if (!found) return null;
        return {
          ...found,
          assignment: assignmentState,
          document: docState,
        };
      });

      (prisma.workHoursCorrectionRequest.findUniqueOrThrow as any).mockImplementation(async (query: any) => {
        const id = query?.where?.id;
        const found = dbCorrectionRequests.find((req) => req.id === id);
        if (!found) throw new Error(`Record with id ${id} not found`);
        return {
          ...found,
          assignment: assignmentState,
          document: docState,
        };
      });

      (prisma.workHoursCorrectionRequest.create as any).mockImplementation(async (args: any) => {
        const newRecord = {
          id: `req-wf-${dbCorrectionRequests.length + 1}`,
          ...args.data,
          assignment: assignmentState,
          document: docState,
        };
        dbCorrectionRequests.push(newRecord);
        return newRecord;
      });

      (prisma.workHoursCorrectionRequest.update as any).mockImplementation(async (args: any) => {
        const id = args.where.id;
        const idx = dbCorrectionRequests.findIndex((r) => r.id === id);
        if (idx >= 0) {
          dbCorrectionRequests[idx] = {
            ...dbCorrectionRequests[idx],
            ...args.data,
          };
          return dbCorrectionRequests[idx];
        }
        throw new Error(`Record ${id} not found for update`);
      });

      (prisma.workHoursCorrectionRequest.updateMany as any).mockImplementation(async (args: any) => {
        const { where, data } = args;
        let count = 0;
        for (let i = 0; i < dbCorrectionRequests.length; i++) {
          const req = dbCorrectionRequests[i];
          if (where.id && req.id !== where.id) continue;
          if (where.status && req.status !== where.status) continue;
          dbCorrectionRequests[i] = {
            ...req,
            ...data,
          };
          count++;
        }
        return { count };
      });

      // 1. Initial State: Effective work hours are 8.0h from the electronic confirmation
      const initialEffective = await getAssignmentEffectiveWorkHours(assignmentId);
      expect(initialEffective.effectiveHours).toBe(8.0);
      expect(initialEffective.isCorrected).toBe(false);
      expect(initialEffective.source).toBe("service_confirmation");

      // 2. Request a correction (proposing 6.5 hours from 08:00 to 15:00, 30m break)
      //    Invoking real production service: createOrUpdateHoursCorrectionRequest
      const adminUser = { id: "admin-wf-1", role: "admin" };
      const createdProposal = await createOrUpdateHoursCorrectionRequest({
        assignmentId,
        documentId: docState.id,
        expectedEffectiveVersion: initialEffective.effectiveVersion,
        expectedBaselineHours: 8.0,
        proposedHours: 6.5,
        proposedStartTime: "08:00",
        proposedEndTime: "15:00",
        proposedBreakMinutes: 30,
        reason: "Mitarbeiter verließ die Schicht früher",
        currentUser: adminUser,
      });

      expect(createdProposal).toBeDefined();
      expect(createdProposal.status).toBe("proposed");
      expect(createdProposal.proposedHoursWorked).toBe(6.5);
      expect(createdProposal.baseVersion).toBe(initialEffective.effectiveVersion);

      // Before approval: Effective hours MUST STILL be 8.0h (the proposal does not alter effective hours)
      const effectiveDuringProposal = await getAssignmentEffectiveWorkHours(assignmentId);
      expect(effectiveDuringProposal.effectiveHours).toBe(8.0);
      expect(effectiveDuringProposal.isCorrected).toBe(false);
      expect(effectiveDuringProposal.source).toBe("service_confirmation");

      // 3. Admin approves correction with expected version token
      //    Invoking real production service: approveHoursCorrectionRequest
      const approvalDecision = await approveHoursCorrectionRequest({
        correctionRequestId: createdProposal.id,
        expectedEffectiveVersion: initialEffective.effectiveVersion,
        effectiveStartTime: "08:00",
        effectiveEndTime: "15:00",
        effectiveBreakMinutes: 30,
        decisionNote: "Genehmigt nach Prüfung des hochgeladenen Stundennachweises",
        currentUser: adminUser,
        decidedAt: new Date("2026-10-02T11:00:00Z"),
      });

      expect(approvalDecision).toBeDefined();
      expect(approvalDecision.status).toBe("approved");
      expect(approvalDecision.revision).toBe(1);

      // After approval: Effective hours are now 6.5h from the approved correction
      const effectiveAfterApproval = await getAssignmentEffectiveWorkHours(assignmentId);
      expect(effectiveAfterApproval.effectiveHours).toBe(6.5);
      expect(effectiveAfterApproval.isCorrected).toBe(true);
      expect(effectiveAfterApproval.source).toBe("approved_correction");
      expect(effectiveAfterApproval.approvedCorrection?.id).toBe(createdProposal.id);

      // 4. Verify ZERO MUTATION of the original electronic confirmation record
      expect(assignmentState.serviceConfirmation.hoursWorked).toBe(8.0);
      expect(assignmentState.serviceConfirmation.signatureData).toBe("data:image/png;base64,original_electronic_sig");
      expect(assignmentState.serviceConfirmation.signerName).toBe("Fr. Schmidt (Original)");
    });

    it("Request 4: Evidence direct streaming without storage signed URL leakage and with filename sanitization", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-1", role: "admin" });

      (prisma.assignment.findUnique as any).mockResolvedValue({
        id: "asg-stream-1",
        serviceConfirmation: null,
        order: { clientId: "c-1", shiftDate: new Date(), client: { userId: "u-c" } },
        worker: { userId: "u-w" },
      });

      (prisma.confirmationDocument.findFirst as any).mockResolvedValue({
        id: "doc-stream-1",
        storagePath: "confirmations/report-clean.pdf",
        fileName: "Nachweis / Test & File.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_upload",
      });

      const res = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/asg-stream-1/document?documentId=doc-stream-1"),
        { params: Promise.resolve({ assignmentId: "asg-stream-1" }) }
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Location")).toBeNull();
      const disposition = res.headers.get("Content-Disposition");
      expect(disposition).toContain('filename="Nachweis__Test___File.pdf"');
      expect(disposition).not.toContain("/");
      expect(disposition).not.toContain("&");
    });

    it("Request 5: Shift overlap engine: identifies overlapping shifts for same worker across facilities, counts worker once, touching shifts yield 0 overlap", () => {
      const workerId = "w-overlap-1";
      const shiftDate = new Date("2026-10-15T00:00:00Z");

      const shifts = [
        {
          assignmentId: "asg-1",
          orderId: "ord-1",
          workerId,
          workerName: "Max Mustermann",
          clientId: "c-1",
          facilityName: "Facility Alpha",
          shiftDate,
          startTime: "08:00",
          endTime: "14:00",
          status: "confirmed",
          assignmentStatus: "confirmed",
        },
        {
          assignmentId: "asg-2",
          orderId: "ord-2",
          workerId,
          workerName: "Max Mustermann",
          clientId: "c-2",
          facilityName: "Facility Beta",
          shiftDate,
          startTime: "13:00",
          endTime: "19:00",
          status: "confirmed",
          assignmentStatus: "confirmed",
        },
        {
          assignmentId: "asg-3",
          orderId: "ord-3",
          workerId,
          workerName: "Max Mustermann",
          clientId: "c-3",
          facilityName: "Facility Gamma",
          shiftDate,
          startTime: "19:00",
          endTime: "23:00",
          status: "confirmed",
          assignmentStatus: "confirmed",
        },
      ];

      const overlapResult = detectShiftOverlaps(shifts, 2026, 10);

      expect(overlapResult.affectedWorkersCount).toBe(1);

      const pair12 = overlapResult.workerGroups[0]?.pairs.find(
        (p) => (p.shiftA.assignmentId === "asg-1" && p.shiftB.assignmentId === "asg-2") ||
               (p.shiftA.assignmentId === "asg-2" && p.shiftB.assignmentId === "asg-1")
      );
      expect(pair12).toBeDefined();
      expect(pair12?.overlapMinutes).toBe(60);

      const pair23 = overlapResult.workerGroups[0]?.pairs.find(
        (p) => (p.shiftA.assignmentId === "asg-2" && p.shiftB.assignmentId === "asg-3") ||
               (p.shiftA.assignmentId === "asg-3" && p.shiftB.assignmentId === "asg-2")
      );
      expect(pair23).toBeUndefined();
    });

    it("Request 6: Stundenübersicht section title vs Stundennachweis document name, separating confirmed actual hours from unverified planned hours", async () => {
      const mockOrders = [
        {
          id: "ord-actual-1",
          shiftDate: new Date("2026-10-01"),
          startTime: "08:00",
          endTime: "14:30",
          breakMinutes: 30,
          requiredQualification: "Pflegefachkraft",
          assignments: [
            {
              id: "asg-act-1",
              status: "confirmed",
              bonusHours: 0,
              worker: { id: "w-1", fullName: "Julia Bauer", internalNumber: "W-10" },
              serviceConfirmation: { hoursWorked: 6.0 },
              hoursCorrections: [],
            },
          ],
        },
        {
          id: "ord-planned-1",
          shiftDate: new Date("2026-10-02"),
          startTime: "08:00",
          endTime: "16:30",
          breakMinutes: 30,
          requiredQualification: "Pflegefachkraft",
          assignments: [
            {
              id: "asg-plan-1",
              status: "scheduled",
              bonusHours: 0,
              worker: { id: "w-1", fullName: "Julia Bauer", internalNumber: "W-10" },
              serviceConfirmation: null,
              hoursCorrections: [],
            },
          ],
        },
      ];

      (prisma.order.findMany as any).mockResolvedValue(mockOrders);

      const actualReport = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        mode: "actual",
      });

      expect(actualReport.totalActualHours).toBe(6.0);
      expect(actualReport.totalPlannedHours).toBe(8.0);
      expect(actualReport.totalHours).toBe(6.0);

      // Section title in UI
      const tabTitle = (deMessages as any).reports?.tabs?.stundennachweis;
      expect(tabTitle).toBe("Stundenübersicht");
      const resultTitle = (deMessages as any).reports?.stundennachweis?.resultTitle;
      expect(resultTitle).toBe("Stundenübersicht");
    });
  });

  // =========================================================================
  // SECTION 4: DICTIONARY KEY PARITY & TRANSLATIONS
  // =========================================================================
  describe("4. Translation Keys and Dictionary Integrity across German, English, and Arabic (Visual Layout and RTL on Screen Remain UNEXECUTED in VISUAL_ACCEPTANCE_GATE_OPEN)", () => {
    it("Verifies required keys exist in de.json, en.json, and ar.json for all Phase 7 management requests", () => {
      // NOTE ON SCOPE: This test proves dictionary key completeness and text presence across German,
      // English, and Arabic. Visual layout, mobile viewport responsiveness, and RTL browser rendering
      // remain unexecuted and declared in VISUAL_ACCEPTANCE_GATE_OPEN.
      const keysToCheck = [
        { section: "reports.stundennachweis", key: "title" },
        { section: "reports.stundennachweis", key: "totalActualHours" },
        { section: "reports.stundennachweis", key: "unverifiedPlannedHours" },
        { section: "reports.stundennachweis", key: "plannedNotice" },
        { section: "confirmations", key: "electronicOriginal" },
        { section: "confirmations", key: "approvedCorrection" },
        { section: "confirmations", key: "pendingCorrection" },
        { section: "confirmations", key: "uploadWorkerTimesheet" },
        { section: "invoicing.tabs", key: "cancelledInvoices" },
        { section: "invoicing", key: "cancelled" },
      ];

      for (const item of keysToCheck) {
        const getVal = (obj: any, pathStr: string) =>
          pathStr.split(".").reduce((acc, part) => acc && acc[part], obj);

        const deVal = getVal(deMessages, `${item.section}.${item.key}`);
        const enVal = getVal(enMessages, `${item.section}.${item.key}`);
        const arVal = getVal(arMessages, `${item.section}.${item.key}`);

        expect(deVal, `Missing DE key: ${item.section}.${item.key}`).toBeDefined();
        expect(enVal, `Missing EN key: ${item.section}.${item.key}`).toBeDefined();
        expect(arVal, `Missing AR key: ${item.section}.${item.key}`).toBeDefined();

        expect(typeof deVal).toBe("string");
        expect(typeof enVal).toBe("string");
        expect(typeof arVal).toBe("string");

        expect(deVal.trim().length).toBeGreaterThan(0);
        expect(enVal.trim().length).toBeGreaterThan(0);
        expect(arVal.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
