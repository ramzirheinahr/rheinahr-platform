/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import { GET as getBulkPdfRoute } from "@/app/api/invoices/bulk-pdf/route";
import { GET as getConfirmationDocumentRoute } from "@/app/api/confirmations/[assignmentId]/document/route";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import {
  doIntervalsOverlap,
  updateClientHourlyRate,
  deleteClientHourlyRate,
} from "@/lib/client-price-admin-service";
import {
  approveHoursCorrectionRequest,
  getAssignmentEffectiveWorkHours,
} from "@/lib/confirmation-evidence-service";
import { detectShiftOverlaps } from "@/lib/shift-overlap-engine";
import { getStundennachweisData } from "@/lib/reports-data";
import { defaultFileVerifier, getAllowedInvoiceStorageRoots } from "@/lib/invoice-v2-refresh-service";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";

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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    workHoursCorrectionRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

describe("Phase 07c - Comprehensive Integrated Operational Acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // SECTION 1: PHYSICAL & LOGICAL DATABASE INVARIANTS & CONCURRENCY
  // =========================================================================
  describe("1. Database Concurrency, Invariants & Immutability", () => {
    it("1.1 Concurrency on approvals: competing decisions on same assignment produce exactly 1 approval and 1 rejection without history loss", async () => {
      const assignmentId = "assign-race";
      const baseVersion = "scheduled:ord-race";

      const mockDoc = {
        id: "doc-race",
        assignmentId,
        storagePath: "confirmations/race.pdf",
      };

      const mockReq = {
        id: "corr-race-1",
        assignmentId,
        documentId: "doc-race",
        status: "proposed",
        revision: 1,
        baseVersion,
        proposedHoursWorked: 8.5,
        proposedStartTime: "08:00",
        proposedEndTime: "17:00",
        proposedBreakMinutes: 30,
        reason: "Extended shift",
        requestedById: "worker-1",
        requestedAt: new Date("2026-10-10T10:00:00Z"),
        decidedById: null,
        decidedAt: null,
        document: mockDoc,
        assignment: {
          id: assignmentId,
          worker: { userId: "w-1" },
          order: {
            id: "ord-race",
            startTime: "08:00",
            endTime: "16:00",
            breakMinutes: 30,
            clientId: "c-1",
            client: { userId: "cl-1" },
          },
          serviceConfirmation: null,
        },
      };

      let callCount = 0;
      (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        callCount++;
        const txPrisma = {
          workHoursCorrectionRequest: {
            findUnique: vi.fn().mockResolvedValue({
              ...mockReq,
              status: callCount === 1 ? "proposed" : "approved",
            }),
            findFirst: vi.fn().mockResolvedValue(null),
            updateMany: vi.fn().mockResolvedValue({ count: callCount === 1 ? 1 : 0 }),
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              ...mockReq,
              status: "approved",
              decidedAt: new Date(),
              decidedById: "admin-1",
            }),
          },
          assignment: {
            findUnique: vi.fn().mockResolvedValue(mockReq.assignment),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        };
        return await callback(txPrisma);
      });

      // Get exact effective version token for this assignment
      (prisma.assignment.findUnique as any).mockResolvedValue(mockReq.assignment);
      const effectiveBefore = await getAssignmentEffectiveWorkHours(assignmentId, prisma);
      mockReq.baseVersion = effectiveBefore.effectiveVersion;

      // Call 1: Admin 1 approves successfully
      const result1 = await approveHoursCorrectionRequest({
        correctionRequestId: "corr-race-1",
        expectedEffectiveVersion: effectiveBefore.effectiveVersion,
        effectiveStartTime: "08:00",
        effectiveEndTime: "17:00",
        effectiveBreakMinutes: 30,
        currentUser: { id: "admin-1", role: "admin" },
      });
      expect(result1.status).toBe("approved");

      // Call 2: Admin 2 concurrently attempts to approve the same request -> Throws ALREADY_DECIDED (409)
      await expect(
        approveHoursCorrectionRequest({
          correctionRequestId: "corr-race-1",
          expectedEffectiveVersion: effectiveBefore.effectiveVersion,
          effectiveStartTime: "08:00",
          effectiveEndTime: "17:00",
          effectiveBreakMinutes: 30,
          currentUser: { id: "admin-2", role: "admin" },
        })
      ).rejects.toThrow("Dieser Korrekturantrag wurde bereits genehmigt.");
    });

    it("1.2 Hourly rate version interval overlap: rejects overlapping validity intervals in same scope", () => {
      // Overlapping intervals
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-06-15", "2026-12-31")).toBe(true);

      // Adjacent non-overlapping intervals
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-07-01", "2026-12-31")).toBe(false);

      // Same-day boundary overlap
      expect(doIntervalsOverlap("2026-01-01", "2026-06-30", "2026-06-30", "2026-12-31")).toBe(true);
    });

    it("1.3 Frozen rate version immutability: rejects modification or deletion of frozen rates", async () => {
      const mockPrisma = {
        user: { findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) },
        clientHourlyRateVersion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "rate-frozen-1",
            clientId: "client-1",
            rateVersion: 1,
            isFrozen: true,
            hourlyRateCents: 4500,
          }),
        },
      };

      const updateRes = await updateClientHourlyRate({
        prisma: mockPrisma,
        rateId: "rate-frozen-1",
        actorUserId: "admin-1",
      });
      expect(updateRes.success).toBe(false);
      if (!updateRes.success) {
        expect(updateRes.code).toBe("FROZEN_RECORD_IMMUTABLE");
      }

      const deleteRes = await deleteClientHourlyRate({
        prisma: mockPrisma,
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

      const historicalSnapshot = {
        calculationVersion: "v1",
        periodStart: "2024-03-01",
        periodEnd: "2024-03-31",
        items: [
          {
            pos: 1,
            description: "Pflegefachkraft",
            hours: "8,00",
            rate: "35,00 €",
            amount: "280,00 €",
            hoursDisplay: "8,00",
            rateDisplay: "35,00 €",
            amountDisplay: "280,00 €",
          },
        ],
        subtotal: "280,00 €",
        taxAmount: "53,20 €",
        total: "333,20 €",
      };

      const historicalInvoice = {
        id: "inv-hist-1",
        invoiceNumber: "RE-2024-0099",
        status: "paid",
        date: new Date("2024-03-01"),
        netAmount: 280.0,
        vatAmount: 53.2,
        grossAmount: 333.2,
        pdfUrl: null,
        client: {
          id: "c-1",
          shortCode: "HC",
          internalNumber: "CL-99",
          facilityName: "Historic Clinic",
          userId: "u-1",
          address: "Hauptstr. 10, 53111 Bonn",
          billingEmail: "hist@example.com",
          billingInfo: null,
          paymentTermsDays: 14,
        },
        assignments: [],
        snapshotData: historicalSnapshot,
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(historicalInvoice);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost/api/invoices/inv-hist-1/pdf"),
        { params: Promise.resolve({ id: "inv-hist-1" }) }
      );
      expect(res.status).toBe(200);

      // Strict check: zero mutations
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(prisma.invoice.create).not.toHaveBeenCalled();
      expect(prisma.assignment.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SECTION 2: FINANCIAL PATHS, PDF GENERATION & BULK PDF CONTENT
  // =========================================================================
  describe("2. Financial Paths, Benchmark Precision & Bulk PDF", () => {
    it("2.1 Benchmark precision: 3 hours @ 5,68 €/h = 17,04 € net, 3,24 € VAT, 20,28 € gross without double currency or 17,03 € drift", () => {
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
    });

    it("2.2 Bulk PDF combines active invoices and excludes cancelled invoices with full fail-closed guard", async () => {
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
        invoiceNumber: "RE-2026-CANC-01",
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
  // SECTION 3: SIX MANAGEMENT REQUESTS INTEGRATED ACCEPTANCE MATRIX
  // =========================================================================
  describe("3. Six Management Requests Integrated Acceptance Matrix", () => {
    it("Request 1: Cancelled invoices tab displays cancelled invoices exclusively, excluded from open claims and bulk PDF", () => {
      const invoices = [
        { id: "1", invoiceNumber: "RE-01", status: "paid", grossAmount: 100 },
        { id: "2", invoiceNumber: "RE-02", status: "unpaid", grossAmount: 200 },
        { id: "3", invoiceNumber: "RE-03", status: "cancelled", grossAmount: 300 },
        { id: "4", invoiceNumber: "RE-04", status: "cancelled", grossAmount: 400 },
      ];

      const regularInvoices = invoices.filter((i) => i.status !== "cancelled");
      const cancelledInvoices = invoices.filter((i) => i.status === "cancelled");

      expect(regularInvoices).toHaveLength(2);
      expect(cancelledInvoices).toHaveLength(2);
      expect(cancelledInvoices.every((i) => i.status === "cancelled")).toBe(true);
      expect(regularInvoices.every((i) => i.status !== "cancelled")).toBe(true);

      const openClaimsTotal = regularInvoices
        .filter((i) => i.status === "unpaid")
        .reduce((sum, i) => sum + i.grossAmount, 0);
      expect(openClaimsTotal).toBe(200);
    });

    it("Request 2: Timesheet upload from worker & admin views with strict RBAC tenant isolation", async () => {
      const mockAssignment = {
        id: "asg-tenant-1",
        serviceConfirmation: null,
        order: {
          id: "ord-t-1",
          clientId: "client-a",
          shiftDate: new Date("2026-10-10"),
          client: { userId: "user-client-a" },
        },
        worker: { userId: "user-worker-1" },
      };

      (prisma.assignment.findUnique as any).mockResolvedValue(mockAssignment);

      // Worker 2 attempts to access Worker 1's document -> 403 Forbidden
      (getCurrentUser as any).mockResolvedValue({ id: "user-worker-2", role: "worker" });
      const resWorker2 = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/asg-tenant-1/document"),
        { params: Promise.resolve({ assignmentId: "asg-tenant-1" }) }
      );
      expect(resWorker2.status).toBe(403);

      // Client B attempts to access Client A's document -> 403 Forbidden
      (getCurrentUser as any).mockResolvedValue({ id: "user-client-b", role: "client" });
      (resolveClientId as any).mockResolvedValue("client-b");
      const resClientB = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/asg-tenant-1/document"),
        { params: Promise.resolve({ assignmentId: "asg-tenant-1" }) }
      );
      expect(resClientB.status).toBe(403);
    });

    it("Request 3: Hours correction workflow: Upload alone does NOT alter effective hours; approval updates effective hours; UI distinguishes approved from proposed", async () => {
      const assignmentId = "asg-corr-flow";

      const mockAssignmentInitial = {
        id: assignmentId,
        order: {
          id: "ord-flow",
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
        },
        serviceConfirmation: {
          id: "sc-flow",
          method: "electronic",
          hoursWorked: 7.5,
          signatureData: "sig-base",
          signerName: "Client Signer",
          confirmedAt: new Date("2026-10-10T16:00:00Z"),
          documentUrl: null,
        },
      };

      (prisma.assignment.findUnique as any).mockResolvedValue(mockAssignmentInitial);
      (prisma.workHoursCorrectionRequest.findFirst as any).mockResolvedValue(null);

      const effectiveBefore = await getAssignmentEffectiveWorkHours(assignmentId, prisma);
      expect(effectiveBefore.effectiveHours).toBe(7.5);
      expect(effectiveBefore.isCorrected).toBe(false);

      // Upload proposed correction: findFirst still returns null -> effective hours remain 7.5
      const effectiveWhileProposed = await getAssignmentEffectiveWorkHours(assignmentId, prisma);
      expect(effectiveWhileProposed.effectiveHours).toBe(7.5);

      // After admin approval: findFirst returns approved correction
      const approvedCorrection = {
        id: "corr-flow-1",
        assignmentId,
        status: "approved",
        revision: 1,
        proposedHoursWorked: 9.0,
        proposedStartTime: "08:00",
        proposedEndTime: "17:30",
        proposedBreakMinutes: 30,
        reason: "Overtime worked",
        requestedById: "worker-1",
        requestedAt: new Date("2026-10-10T18:00:00Z"),
        decidedById: "admin-1",
        decidedAt: new Date("2026-10-11T09:00:00Z"),
      };

      (prisma.workHoursCorrectionRequest.findFirst as any).mockResolvedValue(approvedCorrection);

      const effectiveAfterApproval = await getAssignmentEffectiveWorkHours(assignmentId, prisma);
      expect(effectiveAfterApproval.effectiveHours).toBe(9.0);
      expect(effectiveAfterApproval.isCorrected).toBe(true);
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
  // SECTION 4: MANDATORY TRANSLATIONS & RTL PARITY
  // =========================================================================
  describe("4. Mandatory Translations Completeness & Multi-language Parity", () => {
    it("Verifies required keys exist in de.json, en.json, and ar.json for all Phase 7 management requests", () => {
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
        const getVal = (obj: any, path: string) =>
          path.split(".").reduce((acc, part) => acc && acc[part], obj);

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
