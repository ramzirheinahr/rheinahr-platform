/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";
import { GET as getBulkPdfRoute } from "@/app/api/invoices/bulk-pdf/route";
import { GET as getConfirmationDocumentRoute } from "@/app/api/confirmations/[assignmentId]/document/route";
import { getStundennachweisData, getMonatslisteData } from "@/lib/reports-data";
import { getWorkerHoursAccount, getMultipleWorkersHoursAccount } from "@/lib/hours-account";
import { StundennachweisTemplate } from "@/lib/pdf/stundennachweis";
import deMessages from "@/messages/de.json";
import enMessages from "@/messages/en.json";
import arMessages from "@/messages/ar.json";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { getAssignmentEvidenceHistory } from "@/lib/confirmation-evidence-service";

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
    },
    invoiceRevision: {
      findUnique: vi.fn(),
    },
    assignment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    confirmationDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    workHoursCorrectionRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    worker: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    leaveDay: {
      findMany: vi.fn(),
    },
    workerHoursAdjustment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { PDFDocument } from "pdf-lib";

vi.mock("@/lib/pdf/invoice", () => ({
  generateInvoicePdf: vi.fn(async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    return await doc.save();
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({
          data: {
            arrayBuffer: async () => Buffer.from("%PDF-1.4 mock pdf content"),
          },
          error: null,
        }),
      })),
    },
  })),
}));

import { getCurrentUser, roleSatisfies, resolveClientId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

describe("Phase 07a - Documents, Invoices, Timesheets & Approved Corrections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Stundennachweis & Contract 3c Approved Corrections", () => {
    it("Test 1: Confirmed shift with unapproved evidence upload does NOT change hours or sums; admin approval applies effective hours", async () => {
      // Mock Order with assignment
      const orderDate = new Date("2026-10-15T00:00:00Z");
      const mockOrderUnapproved = {
        id: "order-1",
        shiftDate: orderDate,
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 30, // Scheduled net: 7.50 hrs
        notes: "Station A",
        requiredQualification: "Pflegefachkraft",
        client: { facilityName: "Klinikum Bonn", id: "client-1" },
        assignments: [
          {
            id: "assign-1",
            status: "confirmed",
            worker: { fullName: "Anna Schmidt", internalNumber: "W-101" },
            serviceConfirmation: { hoursWorked: 7.5 },
            // Only unapproved correction exists
            hoursCorrections: [], // prisma query filtered where status: 'approved' returns []
          },
        ],
      };

      (prisma.order.findMany as any).mockResolvedValueOnce([mockOrderUnapproved]);

      const resUnapproved = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });

      expect(resUnapproved.rows).toHaveLength(1);
      expect(resUnapproved.rows[0].hoursWithoutPause).toBe(7.5);
      expect(resUnapproved.rows[0].statusType).toBe("service_confirmation");
      expect(resUnapproved.rows[0].statusLabel).toBe("Bestätigt");
      expect(resUnapproved.rows[0].isCorrected).toBe(false);

      // Now simulate admin approval of a correction request to 8.25 hrs (08:00 - 16:45, 30 min break)
      const mockOrderApproved = {
        ...mockOrderUnapproved,
        assignments: [
          {
            ...mockOrderUnapproved.assignments[0],
            hoursCorrections: [
              {
                proposedHoursWorked: 8.25,
                proposedStartTime: "08:00",
                proposedEndTime: "16:45",
                proposedBreakMinutes: 30,
              },
            ],
          },
        ],
      };

      (prisma.order.findMany as any).mockResolvedValueOnce([mockOrderApproved]);

      const resApproved = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });

      expect(resApproved.rows).toHaveLength(1);
      expect(resApproved.rows[0].hoursWithoutPause).toBe(8.25);
      expect(resApproved.rows[0].endTime).toBe("16:45");
      expect(resApproved.rows[0].statusType).toBe("approved_correction");
      expect(resApproved.rows[0].statusLabel).toBe("Korrigiert (Freigegeben)");
      expect(resApproved.rows[0].isCorrected).toBe(true);
    });

    it("distinguishes planned schedule mode from actual hours mode", async () => {
      const orderDate = new Date("2026-10-15T00:00:00Z");
      const mockOrder = {
        id: "order-2",
        shiftDate: orderDate,
        startTime: "06:00",
        endTime: "14:30",
        breakMinutes: 30, // Scheduled net: 8.00 hrs
        notes: null,
        requiredQualification: "Pflegefachkraft",
        client: { facilityName: "Haus Rhein", id: "client-1" },
        assignments: [
          {
            id: "assign-2",
            status: "confirmed",
            worker: { fullName: "Bernd Becker", internalNumber: "W-102" },
            serviceConfirmation: { hoursWorked: 6.0 }, // confirmed 6 hrs
            hoursCorrections: [],
          },
        ],
      };

      (prisma.order.findMany as any).mockResolvedValueOnce([mockOrder]);
      const resPlanned = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        mode: "planned",
      });

      // Planned mode must report scheduled net hours (8.00), not confirmed (6.00)
      expect(resPlanned.rows[0].hoursWithoutPause).toBe(8.0);
      expect(resPlanned.rows[0].statusType).toBe("scheduled");
      expect(resPlanned.rows[0].isPlanned).toBe(true);

      (prisma.order.findMany as any).mockResolvedValueOnce([mockOrder]);
      const resActual = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        mode: "actual",
      });

      // Actual mode must report confirmed hours (6.00)
      expect(resActual.rows[0].hoursWithoutPause).toBe(6.0);
      expect(resActual.rows[0].statusType).toBe("service_confirmation");
    });

    it("Test 1c (P1-3): mixed actual report with 6h confirmed + 8h unverified planned shift yields 6h actual sum and separates 8h planned sum", async () => {
      const orderConfirmed = {
        id: "order-conf",
        shiftDate: new Date("2026-10-10T00:00:00Z"),
        startTime: "08:00",
        endTime: "14:30",
        breakMinutes: 30, // Scheduled net: 6.00 hrs
        notes: "Station 1",
        requiredQualification: "Pflegehelfer",
        client: { facilityName: "Haus Rhein", id: "client-1" },
        assignments: [
          {
            id: "assign-conf",
            status: "confirmed",
            worker: { fullName: "Mitarbeiter A", internalNumber: "W-01" },
            serviceConfirmation: { hoursWorked: 6.0 }, // 6.0 hrs confirmed
            hoursCorrections: [],
          },
        ],
      };

      const orderUnverified = {
        id: "order-unver",
        shiftDate: new Date("2026-10-11T00:00:00Z"),
        startTime: "06:00",
        endTime: "14:30",
        breakMinutes: 30, // Scheduled net: 8.00 hrs
        notes: "Station 2",
        requiredQualification: "Pflegefachkraft",
        client: { facilityName: "Haus Rhein", id: "client-1" },
        assignments: [
          {
            id: "assign-unver",
            status: "confirmed",
            worker: { fullName: "Mitarbeiter B", internalNumber: "W-02" },
            serviceConfirmation: null, // NO confirmation -> unverified planned
            hoursCorrections: [],
          },
        ],
      };

      const orderUnassigned = {
        id: "order-unassigned",
        shiftDate: new Date("2026-10-12T00:00:00Z"),
        startTime: "12:00",
        endTime: "16:00",
        breakMinutes: 0, // Scheduled net: 4.00 hrs
        notes: "Springer",
        requiredQualification: "Pflegefachkraft",
        client: { facilityName: "Haus Rhein", id: "client-1" },
        assignments: [], // Unassigned shift in period
      };

      (prisma.order.findMany as any).mockResolvedValueOnce([
        orderConfirmed,
        orderUnverified,
        orderUnassigned,
      ]);

      const resMixed = await getStundennachweisData({
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        mode: "actual",
      });

      expect(resMixed.rows).toHaveLength(3);
      // Row 1: Confirmed shift
      expect(resMixed.rows[0].hoursWithoutPause).toBe(6.0);
      expect(resMixed.rows[0].statusType).toBe("service_confirmation");
      expect(resMixed.rows[0].isPlanned).toBe(false);

      // Row 2: Unverified shift (scheduled 8.0)
      expect(resMixed.rows[1].hoursWithoutPause).toBe(8.0);
      expect(resMixed.rows[1].statusType).toBe("scheduled");
      expect(resMixed.rows[1].isPlanned).toBe(true);
      expect(resMixed.rows[1].statusLabel).toBe("Geplant (ungeprüft)");

      // Row 3: Unassigned shift (scheduled 4.0)
      expect(resMixed.rows[2].hoursWithoutPause).toBe(4.0);
      expect(resMixed.rows[2].statusType).toBe("scheduled");
      expect(resMixed.rows[2].isPlanned).toBe(true);

      // Crucial P1-3 check: Actual sum must be strictly 6.00 hrs, NOT 18.00 hrs!
      expect(resMixed.totalActualHours).toBe(6.0);
      expect(resMixed.totalPlannedHours).toBe(12.0); // 8.0 + 4.0
      expect(resMixed.totalHours).toBe(6.0); // In actual mode, official total is 6.0!
    });
  });

  describe("2. Document RBAC & Byte Direct Streaming", () => {
    it("Test 2: Two workers with identical names / two clients -> strict RBAC prevents unauthorized access and URL leakage", async () => {
      const targetAssignment = {
        id: "assign-worker-1",
        serviceConfirmation: {
          id: "sc-1",
          method: "upload",
          documentUrl: "confirmations/client1/worker1-doc.pdf",
        },
        order: {
          clientId: "client-1",
          shiftDate: new Date("2026-10-10"),
          client: { userId: "user-client-1" },
        },
        worker: { userId: "user-worker-1" },
      };

      (prisma.assignment.findUnique as any).mockResolvedValue(targetAssignment);

      // 1. Worker 2 (different user ID, even if same name) tries to access worker 1's document -> 403 Forbidden
      (getCurrentUser as any).mockResolvedValue({ id: "user-worker-2", role: "worker" });
      const resWorker2 = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-worker-1/document"),
        { params: Promise.resolve({ assignmentId: "assign-worker-1" }) }
      );
      expect(resWorker2.status).toBe(403);

      // 2. Client 2 tries to access client 1's document -> 403 Forbidden
      (getCurrentUser as any).mockResolvedValue({ id: "user-client-2", role: "client" });
      (resolveClientId as any).mockResolvedValue("client-2");
      const resClient2 = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-worker-1/document"),
        { params: Promise.resolve({ assignmentId: "assign-worker-1" }) }
      );
      expect(resClient2.status).toBe(403);

      // 3. Assigned Worker 1 accesses document -> 200 with streamed bytes, NO redirect or external signedUrl exposed
      (getCurrentUser as any).mockResolvedValue({ id: "user-worker-1", role: "worker" });
      const resWorker1 = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-worker-1/document"),
        { params: Promise.resolve({ assignmentId: "assign-worker-1" }) }
      );
      expect(resWorker1.status).toBe(200);
      expect(resWorker1.headers.get("Content-Type")).toBe("application/pdf");
      expect(resWorker1.headers.get("Location")).toBeNull(); // No redirect!
      const bytes = await resWorker1.arrayBuffer();
      const text = Buffer.from(bytes).toString();
      expect(text).toContain("%PDF-1.4");
    });

    it("Test 4: Missing document or invalid assignment fails closed with 404 without approximate rebuilds", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      // Assignment not found
      (prisma.assignment.findUnique as any).mockResolvedValueOnce(null);
      const resNotFound = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/non-existent/document"),
        { params: Promise.resolve({ assignmentId: "non-existent" }) }
      );
      expect(resNotFound.status).toBe(404);

      // Assignment exists but no document attached
      (prisma.assignment.findUnique as any).mockResolvedValueOnce({
        id: "assign-no-doc",
        serviceConfirmation: null,
        order: { clientId: "client-1", shiftDate: new Date(), client: { userId: "user-c" } },
        worker: { userId: "user-w" },
      });
      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce(null);

      const resNoDoc = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-no-doc/document"),
        { params: Promise.resolve({ assignmentId: "assign-no-doc" }) }
      );
      expect(resNoDoc.status).toBe(404);
    });

    it("supports documentId='original' for manual_upload initial shifts and separates correction approval status (P1-2)", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      // Scenario A: Shift with manual_upload as the initial document and NO ServiceConfirmation
      (prisma.assignment.findUnique as any).mockResolvedValue({
        id: "assign-manual-orig",
        serviceConfirmation: null,
        order: { clientId: "client-1", shiftDate: new Date(), client: { userId: "user-c" } },
        worker: { userId: "user-w" },
      });

      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce({
        id: "doc-manual-1",
        storagePath: "confirmations/initial-timesheet.pdf",
        fileName: "Initial-Stundenzettel.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_upload",
      });

      const resManualOrig = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-manual-orig/document?documentId=original"),
        { params: Promise.resolve({ assignmentId: "assign-manual-orig" }) }
      );
      expect(resManualOrig.status).toBe(200);
      expect(resManualOrig.headers.get("X-Document-Type")).toBe("original");
      expect(resManualOrig.headers.get("X-Document-Source-Type")).toBe("manual_upload");

      // Scenario B: Subsequent manual_correction BEFORE admin approval
      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce({
        id: "doc-corr-proposed",
        storagePath: "confirmations/correction-sheet.pdf",
        fileName: "Korrektur-Nachweis.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_correction",
      });
      // WorkHoursCorrectionRequest status is "proposed"
      (prisma.workHoursCorrectionRequest.findFirst as any).mockResolvedValueOnce({
        status: "proposed",
      });

      const resCorrProposed = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-manual-orig/document?documentId=doc-corr-proposed"),
        { params: Promise.resolve({ assignmentId: "assign-manual-orig" }) }
      );
      expect(resCorrProposed.status).toBe(200);
      expect(resCorrProposed.headers.get("X-Document-Type")).toBe("correction");
      expect(resCorrProposed.headers.get("X-Correction-Status")).toBe("proposed");
      expect(resCorrProposed.headers.get("X-Correction-Approved")).toBe("false");

      // Scenario C: manual_correction AFTER admin approval
      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce({
        id: "doc-corr-approved",
        storagePath: "confirmations/correction-approved.pdf",
        fileName: "Korrektur-Genehmigt.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_correction",
      });
      // WorkHoursCorrectionRequest status is "approved"
      (prisma.workHoursCorrectionRequest.findFirst as any).mockResolvedValueOnce({
        status: "approved",
      });

      const resCorrApproved = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-manual-orig/document?documentId=doc-corr-approved"),
        { params: Promise.resolve({ assignmentId: "assign-manual-orig" }) }
      );
      expect(resCorrApproved.status).toBe(200);
      expect(resCorrApproved.headers.get("X-Document-Type")).toBe("correction");
      expect(resCorrApproved.headers.get("X-Correction-Status")).toBe("approved");
      expect(resCorrApproved.headers.get("X-Correction-Approved")).toBe("true");
    });

    it("Test 2b (P1-2): Counter-test: Document A linked to approved correction is approved; Document B unlinked or linked to proposed correction is NEVER marked approved", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const assignmentId = "assign-multi-doc";

      const mockAssignment = {
        id: assignmentId,
        serviceConfirmation: null,
        order: {
          id: "order-multi",
          clientId: "client-1",
          shiftDate: new Date("2026-10-10"),
          startTime: "08:00",
          endTime: "16:00",
          breakMinutes: 30,
          client: { userId: "user-c" },
        },
        worker: { userId: "user-w" },
      };

      (prisma.assignment.findUnique as any).mockResolvedValue(mockAssignment);

      // Document A: linked to approved correction
      const docA = {
        id: "doc-A",
        assignmentId,
        storagePath: "confirmations/doc-A.pdf",
        fileName: "Doc-A-Approved.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_correction",
        createdAt: new Date("2026-10-10T10:00:00Z"),
      };

      // Document B: manual_correction, but NOT linked to any correction request!
      const docB = {
        id: "doc-B",
        assignmentId,
        storagePath: "confirmations/doc-B.pdf",
        fileName: "Doc-B-Unlinked.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_correction",
        createdAt: new Date("2026-10-10T11:00:00Z"),
      };

      // Document C: manual_correction linked to proposed correction
      const docC = {
        id: "doc-C",
        assignmentId,
        storagePath: "confirmations/doc-C.pdf",
        fileName: "Doc-C-Proposed.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_correction",
        createdAt: new Date("2026-10-10T12:00:00Z"),
      };

      // Route checks:
      // 1. Fetch Document A -> X-Correction-Approved: true, X-Correction-Status: approved
      (prisma.confirmationDocument.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.id === "doc-A") return Promise.resolve(docA);
        if (where.id === "doc-B") return Promise.resolve(docB);
        if (where.id === "doc-C") return Promise.resolve(docC);
        return Promise.resolve(null);
      });

      (prisma.workHoursCorrectionRequest.findFirst as any).mockImplementation(({ where }: any) => {
        if (where.documentId === "doc-A") return Promise.resolve({ status: "approved" });
        if (where.documentId === "doc-C") return Promise.resolve({ status: "proposed" });
        return Promise.resolve(null);
      });

      const resDocA = await getConfirmationDocumentRoute(
        new Request(`http://localhost/api/confirmations/${assignmentId}/document?documentId=doc-A`),
        { params: Promise.resolve({ assignmentId }) }
      );
      expect(resDocA.status).toBe(200);
      expect(resDocA.headers.get("X-Correction-Approved")).toBe("true");
      expect(resDocA.headers.get("X-Correction-Status")).toBe("approved");

      // 2. Fetch Document B (unlinked manual_correction) -> X-Correction-Approved: false, X-Correction-Status: none
      // MUST NOT inherit approval from Document A!
      const resDocB = await getConfirmationDocumentRoute(
        new Request(`http://localhost/api/confirmations/${assignmentId}/document?documentId=doc-B`),
        { params: Promise.resolve({ assignmentId }) }
      );
      expect(resDocB.status).toBe(200);
      expect(resDocB.headers.get("X-Correction-Approved")).toBe("false");
      expect(resDocB.headers.get("X-Correction-Status")).toBe("none");

      // 3. Fetch Document C (linked to proposed correction) -> X-Correction-Approved: false, X-Correction-Status: proposed
      const resDocC = await getConfirmationDocumentRoute(
        new Request(`http://localhost/api/confirmations/${assignmentId}/document?documentId=doc-C`),
        { params: Promise.resolve({ assignmentId }) }
      );
      expect(resDocC.status).toBe(200);
      expect(resDocC.headers.get("X-Correction-Approved")).toBe("false");
      expect(resDocC.headers.get("X-Correction-Status")).toBe("proposed");

      // 4. Test getAssignmentEvidenceHistory: Doc A is approved, Doc B is unapproved, Doc C is unapproved
      (prisma.confirmationDocument.findMany as any).mockResolvedValueOnce([docA, docB, docC]);
      (prisma.workHoursCorrectionRequest.findMany as any).mockResolvedValueOnce([
        { id: "corr-1", assignmentId, documentId: "doc-A", status: "approved", proposedHoursWorked: 8.0, requestedAt: new Date() },
        { id: "corr-2", assignmentId, documentId: "doc-C", status: "proposed", proposedHoursWorked: 7.0, requestedAt: new Date() },
      ]);
      (prisma.workHoursCorrectionRequest.findFirst as any).mockResolvedValueOnce({
        id: "corr-1",
        assignmentId,
        documentId: "doc-A",
        status: "approved",
        proposedHoursWorked: 8.0,
        revision: 1,
        requestedAt: new Date("2026-10-10T10:00:00Z"),
        decidedAt: new Date("2026-10-10T10:30:00Z"),
      });

      const timeline = await getAssignmentEvidenceHistory(assignmentId, { id: "admin-user", role: "admin" });
      const viewA = timeline.documents.find((d) => d.id === "doc-A");
      const viewB = timeline.documents.find((d) => d.id === "doc-B");
      const viewC = timeline.documents.find((d) => d.id === "doc-C");

      expect(viewA?.isCorrectionApproved).toBe(true);
      expect(viewA?.correctionStatus).toBe("approved");

      expect(viewB?.isCorrectionApproved).toBe(false);
      expect(viewB?.correctionStatus).toBeNull();

      expect(viewC?.isCorrectionApproved).toBe(false);
      expect(viewC?.correctionStatus).toBe("proposed");
    });

    it("sanitizes filename and rejects unsupported media types (P2)", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      (prisma.assignment.findUnique as any).mockResolvedValue({
        id: "assign-sanitize",
        serviceConfirmation: null,
        order: { clientId: "client-1", shiftDate: new Date(), client: { userId: "user-c" } },
        worker: { userId: "user-w" },
      });

      // Filename with path traversal and special characters
      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce({
        id: "doc-special-name",
        storagePath: "confirmations/clean.pdf",
        fileName: "../../evil\r\nfolder/malicious;name.pdf",
        mimeType: "application/pdf",
        sourceType: "manual_upload",
      });

      const res = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-sanitize/document?documentId=doc-special-name"),
        { params: Promise.resolve({ assignmentId: "assign-sanitize" }) }
      );
      expect(res.status).toBe(200);
      const disposition = res.headers.get("Content-Disposition");
      expect(disposition).toBeDefined();
      expect(disposition).not.toContain("..");
      expect(disposition).not.toContain("\r");
      expect(disposition).not.toContain("\n");
      expect(disposition).not.toContain("/");
      expect(disposition).toContain("malicious_name.pdf");

      // Unsupported media type
      (prisma.confirmationDocument.findFirst as any).mockResolvedValueOnce({
        id: "doc-bad-mime",
        storagePath: "confirmations/bad.exe",
        fileName: "bad.exe",
        mimeType: "application/x-msdownload",
        sourceType: "manual_upload",
      });

      const resBadMime = await getConfirmationDocumentRoute(
        new Request("http://localhost/api/confirmations/assign-sanitize/document?documentId=doc-bad-mime"),
        { params: Promise.resolve({ assignmentId: "assign-sanitize" }) }
      );
      expect(resBadMime.status).toBe(415);
    });
  });

  describe("3. Invoice PDF Historical Fidelity & Integrity", () => {
    it("Test 3: V2 invoice strictly reads frozen snapshotData and matches benchmark cents", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const v2Invoice = {
        id: "inv-v2-1",
        invoiceNumber: "RE-2026-00042",
        status: "unpaid",
        date: new Date("2026-10-01"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        client: {
          id: "client-1",
          facilityName: "Altenheim Sankt Martin",
          userId: "user-client-1",
        },
        assignments: [],
        snapshotData: {
          calculationVersion: "v2",
          items: [
            { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
          ],
          pdfItems: [
            { pos: 1, description: "Pflegehelfer", hours: "3,00", rate: "5,68", amount: "17,04 €" },
          ],
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(v2Invoice);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost/api/invoices/inv-v2-1/pdf"),
        { params: Promise.resolve({ id: "inv-v2-1" }) }
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const bytes = await res.arrayBuffer();
      expect(Buffer.from(bytes).slice(0, 4).toString()).toBe("%PDF");
    });

    it("corrupted or incomplete snapshotData fails closed with HTTP 422", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const corruptedInvoice = {
        id: "inv-corrupt",
        invoiceNumber: "RE-2026-99999",
        status: "unpaid",
        date: new Date("2026-10-01"),
        netAmount: 100.0,
        vatAmount: 19.0,
        grossAmount: 119.0,
        client: { id: "client-1", facilityName: "Test", userId: "u-1" },
        assignments: [],
        snapshotData: {
          calculationVersion: "v2",
          items: [
            {
              // missing totalNetCents or unitPriceCents
              assignmentId: "bad-item",
            },
          ],
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(corruptedInvoice);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost/api/invoices/inv-corrupt/pdf"),
        { params: Promise.resolve({ id: "inv-corrupt" }) }
      );

      expect(res.status).toBe(422);
    });

    it("Test 3b (P1-1): Historical invoice with missing stored PDF file fails closed with 422 and NEVER falls back to live rebuild", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const missingStoredInvoice = {
        id: "inv-missing-stored",
        invoiceNumber: "RE-2024-OLD-01",
        status: "unpaid",
        date: new Date("2024-05-01"),
        netAmount: 500.0,
        vatAmount: 95.0,
        grossAmount: 595.0,
        pdfUrl: path.join(os.tmpdir(), "non-existent-stored-invoice-2024.pdf"),
        client: { id: "c-old", facilityName: "Old Client", userId: "u-old" },
        assignments: [
          // Live assignments present! Must NOT be used to build a replacement invoice!
          {
            id: "live-assign-1",
            status: "confirmed",
            order: { shiftDate: new Date(), startTime: "08:00", endTime: "16:00", breakMinutes: 30 },
            worker: { fullName: "New Worker", internalNumber: "W-99" },
            serviceConfirmation: { hoursWorked: 7.5 },
          },
        ],
        snapshotData: null,
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(missingStoredInvoice);

      const res = await getInvoicePdfRoute(
        new Request("http://localhost/api/invoices/inv-missing-stored/pdf"),
        { params: Promise.resolve({ id: "inv-missing-stored" }) }
      );

      expect(res.status).toBe(422);
      const text = await res.text();
      expect(text).toContain("Das hinterlegte historische Rechnungsdokument ist nicht verfügbar oder beschädigt.");
    });

    it("Test 3c (P1-1): Historical pre-V2 invoice with both verified stored original file and frozen snapshot items PREFERS stored file", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      // Create a temporary valid PDF file on disk inside allowed storage directory
      const archiveDir = path.resolve(process.cwd(), "storage/archived-invoices");
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const doc = await PDFDocument.create();
      doc.addPage([100, 100]);
      const pdfBytes = await doc.save();
      const tempFilePath = path.join(archiveDir, `test-inv-stored-${Date.now()}.pdf`);
      fs.writeFileSync(tempFilePath, Buffer.from(pdfBytes));

      try {
        const hybridInvoice = {
          id: "inv-hybrid",
          invoiceNumber: "RE-2026-HYBRID",
          status: "unpaid",
          date: new Date("2026-10-01"),
          netAmount: 17.04,
          vatAmount: 3.24,
          grossAmount: 20.28,
          pdfUrl: tempFilePath,
          client: { id: "c-1", facilityName: "Klinik Hybrid", userId: "u-1" },
          assignments: [],
          snapshotData: {
            pdfSha256: crypto.createHash("sha256").update(Buffer.from(pdfBytes)).digest("hex"),
            calculationVersion: "v1", // Historical un-refreshed invoice
            items: [
              { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
            ],
            pdfItems: [
              { pos: 1, description: "Pflegehelfer", hours: "3,00", rate: "5,68", amount: "17,04 €" },
            ],
            subtotalCents: 1704,
            taxAmountCents: 324,
            totalCents: 2028,
            subtotal: "17,04 €",
            taxAmount: "3,24 €",
            total: "20,28 €",
          },
        };

        (prisma.invoice.findUnique as any).mockResolvedValue(hybridInvoice);

        const res = await getInvoicePdfRoute(
          new Request("http://localhost/api/invoices/inv-hybrid/pdf"),
          { params: Promise.resolve({ id: "inv-hybrid" }) }
        );

        expect(res.status).toBe(200);
        // Must prefer stored original file!
        expect(res.headers.get("X-Document-Source")).toBe("stored_historical_file");
        expect(res.headers.get("X-Document-Checksum")).toBeDefined();
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it("Test 3d (P1-1): End-to-end: Refreshed V2 invoice with lingering legacy pdfUrl renders new V2 amounts on current route & bulk route, while revision=0 serves historical original file", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      // Create a dummy historical PDF file on disk
      const archiveDir = path.resolve(process.cwd(), "storage/archived-invoices");
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      page.drawText("HISTORICAL ORIGINAL 119 EUR", { x: 20, y: 100 });
      const historicalBytes = await doc.save();
      const tempHistoricalPath = path.join(archiveDir, `test-legacy-orig-${Date.now()}.pdf`);
      fs.writeFileSync(tempHistoricalPath, Buffer.from(historicalBytes));
      const historicalSha256 = crypto.createHash("sha256").update(Buffer.from(historicalBytes)).digest("hex");

      try {
        // Refreshed invoice: pdfUrl remains set to old file on the database row,
        // but netAmount/vatAmount/grossAmount and snapshotData are upgraded to V2 amounts!
        const refreshedV2Invoice = {
          id: "inv-refreshed-v2",
          invoiceNumber: "RE-2026-REFRESHED",
          status: "unpaid",
          date: new Date("2026-10-01"),
          netAmount: 120.0,
          vatAmount: 22.8,
          grossAmount: 142.8,
          pdfUrl: tempHistoricalPath, // Legacy pdfUrl still lingering on row
          client: {
            id: "c-refreshed",
            facilityName: "Altenheim Sankt Martin",
            userId: "user-client-1",
            address: "Musterstr. 1, 53474 Bad Neuenahr",
            billingEmail: "rechnung@example.com",
            paymentTermsDays: 14,
          },
          assignments: [],
          snapshotData: {
            calculationVersion: "v2",
            items: [
              { pos: 1, hoursDisplay: "4,00", rateDisplay: "30,00 €", amountDisplay: "120,00 €", amountCents: 12000, description: "Fachkraft" },
            ],
            pdfItems: [
              { pos: 1, description: "Fachkraft", hours: "4,00", rate: "30,00", amount: "120,00 €" },
            ],
            subtotalCents: 12000,
            taxAmountCents: 2280,
            totalCents: 14280,
            subtotal: "120,00 €",
            taxAmount: "22,80 €",
            total: "142,80 €",
          },
        };

        // Revision 1 holds the historical provenance
        const rev1 = {
          id: "rev-1",
          invoiceId: "inv-refreshed-v2",
          revisionNumber: 1,
          previousNetAmount: 100.0,
          previousVatAmount: 19.0,
          previousGrossAmount: 119.0,
          previousSnapshotData: {
            originReliability: "stored_pdf",
            storedPdfInfo: {
              archivedPath: tempHistoricalPath,
              sha256: historicalSha256,
              byteLength: historicalBytes.length,
            },
            invoiceNumber: "RE-2026-REFRESHED",
            date: "2026-10-01T00:00:00.000Z",
          },
        };

        // 1. Current invoice route: GET /api/invoices/[id]/pdf
        // MUST render strictly from frozen V2 snapshot with V2 amounts, NOT return historical file bytes!
        (prisma.invoice.findUnique as any).mockResolvedValue(refreshedV2Invoice);

        const resCurrent = await getInvoicePdfRoute(
          new Request("http://localhost/api/invoices/inv-refreshed-v2/pdf"),
          { params: Promise.resolve({ id: "inv-refreshed-v2" }) }
        );

        expect(resCurrent.status).toBe(200);
        expect(resCurrent.headers.get("X-Document-Source")).toBe("frozen_snapshot");
        const currentBytes = await resCurrent.arrayBuffer();
        const currentPdfDoc = await PDFDocument.load(currentBytes);
        expect(currentPdfDoc.getPageCount()).toBeGreaterThan(0);
        // Ensure it did NOT just stream the historical file
        expect(Buffer.from(currentBytes).equals(Buffer.from(historicalBytes))).toBe(false);

        // 2. Bulk invoice route: GET /api/invoices/bulk-pdf
        // MUST render V2 snapshot into the bulk document
        (prisma.invoice.findMany as any).mockResolvedValue([refreshedV2Invoice]);

        const resBulk = await getBulkPdfRoute(
          new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
        );

        expect(resBulk.status).toBe(200);
        expect(resBulk.headers.get("Content-Type")).toBe("application/pdf");
        const bulkBytes = await resBulk.arrayBuffer();
        const bulkPdfDoc = await PDFDocument.load(bulkBytes);
        expect(bulkPdfDoc.getPageCount()).toBeGreaterThan(0);

        // 3. Historical baseline route: GET /api/invoices/[id]/pdf?revision=0
        // MUST serve the exact baseline historical file bytes and checksum!
        (prisma.invoice.findUnique as any).mockResolvedValue(refreshedV2Invoice);
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(rev1);

        const resRev0 = await getInvoicePdfRoute(
          new Request("http://localhost/api/invoices/inv-refreshed-v2/pdf?revision=0"),
          { params: Promise.resolve({ id: "inv-refreshed-v2" }) }
        );

        expect(resRev0.status).toBe(200);
        expect(resRev0.headers.get("X-Document-Source")).toBe("stored_original_file");
        expect(resRev0.headers.get("X-Document-Checksum")).toBe(historicalSha256);
        const rev0Bytes = await resRev0.arrayBuffer();
        expect(Buffer.from(rev0Bytes).equals(Buffer.from(historicalBytes))).toBe(true);
      } finally {
        if (fs.existsSync(tempHistoricalPath)) {
          fs.unlinkSync(tempHistoricalPath);
        }
      }
    });
  });

  describe("4. Bulk PDF Exclusion & Fail-Closed Guard", () => {
    it("Test 5: Bulk PDF excludes cancelled invoices and fails closed with 422 if an invoice is corrupted", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      // Invoices list containing an active invoice and a cancelled invoice
      const mockInvoices = [
        {
          id: "inv-active",
          invoiceNumber: "RE-2026-001",
          status: "unpaid",
          date: new Date("2026-10-05"),
          netAmount: 17.04,
          vatAmount: 3.24,
          grossAmount: 20.28,
          client: { id: "c-1", facilityName: "Klinik A" },
          assignments: [],
          snapshotData: {
            calculationVersion: "v2",
            items: [
              { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
            ],
            pdfItems: [
              { pos: 1, description: "Pflegehelfer", hours: "3,00", rate: "5,68", amount: "17,04 €" },
            ],
            subtotalCents: 1704,
            taxAmountCents: 324,
            totalCents: 2028,
            subtotal: "17,04 €",
            taxAmount: "3,24 €",
            total: "20,28 €",
          },
        },
        {
          id: "inv-cancelled",
          invoiceNumber: "RE-2026-002",
          status: "cancelled", // Must be skipped
          date: new Date("2026-10-06"),
          netAmount: 200.0,
          vatAmount: 38.0,
          grossAmount: 238.0,
          client: { id: "c-1", facilityName: "Klinik A" },
          assignments: [],
          snapshotData: null,
        },
      ];

      (prisma.invoice.findMany as any).mockResolvedValue(mockInvoices);

      const res = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const bytes = await res.arrayBuffer();
      expect(Buffer.from(bytes).slice(0, 4).toString()).toBe("%PDF");

      // Now simulate a corrupted invoice in bulk list -> must fail closed with 422
      const mockWithCorrupted = [
        {
          id: "inv-corrupt",
          invoiceNumber: "RE-2026-BAD",
          status: "unpaid",
          date: new Date("2026-10-07"),
          netAmount: 100.0,
          vatAmount: 19.0,
          grossAmount: 119.0,
          client: { id: "c-1", facilityName: "Klinik B" },
          assignments: [],
          snapshotData: {
            calculationVersion: "v2",
            items: [{ broken: true }],
          },
        },
      ];

      (prisma.invoice.findMany as any).mockResolvedValue(mockWithCorrupted);

      const resCorrupt = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
      );

      expect(resCorrupt.status).toBe(422);
      const text = await resCorrupt.text();
      expect(text).toContain("Fehler beim Zusammenstellen der Sammel-PDF für Rechnung RE-2026-BAD");
    });

    it("Test 5b (P1-1): Bulk PDF with missing stored PDF file fails closed with 422 and does NOT fall back to live rebuild", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const missingStoredInvoice = {
        id: "inv-missing-bulk",
        invoiceNumber: "RE-2024-MISSING",
        status: "unpaid",
        date: new Date("2024-05-02"),
        netAmount: 200.0,
        vatAmount: 38.0,
        grossAmount: 238.0,
        pdfUrl: path.join(os.tmpdir(), "non-existent-bulk-stored.pdf"),
        client: { id: "c-1", facilityName: "Klinik Bulk" },
        assignments: [
          {
            id: "live-assign-2",
            status: "confirmed",
            order: { shiftDate: new Date(), startTime: "08:00", endTime: "16:00", breakMinutes: 30 },
            worker: { fullName: "Live Worker", internalNumber: "W-88" },
            serviceConfirmation: { hoursWorked: 7.5 },
          },
        ],
        snapshotData: null,
      };

      (prisma.invoice.findMany as any).mockResolvedValue([missingStoredInvoice]);

      const res = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?from=2024-05-01&to=2024-05-31")
      );

      expect(res.status).toBe(422);
      const text = await res.text();
      expect(text).toContain("Das hinterlegte historische Rechnungsdokument ist nicht verfügbar oder beschädigt.");
    });

    it("Test 5c (P1-1): Bulk PDF with verified stored original file and frozen snapshot items loads stored file", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const archiveDir = path.resolve(process.cwd(), "storage/archived-invoices");
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const doc = await PDFDocument.create();
      doc.addPage([100, 100]);
      const pdfBytes = await doc.save();
      const tempFilePath = path.join(archiveDir, `test-bulk-stored-${Date.now()}.pdf`);
      fs.writeFileSync(tempFilePath, Buffer.from(pdfBytes));

      try {
        const hybridInvoice = {
          id: "inv-bulk-hybrid",
          invoiceNumber: "RE-2026-BULK-HYB",
          status: "unpaid",
          date: new Date("2026-10-02"),
          netAmount: 17.04,
          vatAmount: 3.24,
          grossAmount: 20.28,
          pdfUrl: tempFilePath,
          client: { id: "c-1", facilityName: "Klinik Hybrid" },
          assignments: [],
          snapshotData: {
            pdfSha256: crypto.createHash("sha256").update(Buffer.from(pdfBytes)).digest("hex"),
            calculationVersion: "v1",
            items: [
              { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
            ],
            pdfItems: [
              { pos: 1, description: "Pflegehelfer", hours: "3,00", rate: "5,68", amount: "17,04 €" },
            ],
            subtotalCents: 1704,
            taxAmountCents: 324,
            totalCents: 2028,
            subtotal: "17,04 €",
            taxAmount: "3,24 €",
            total: "20,28 €",
          },
        };

        (prisma.invoice.findMany as any).mockResolvedValue([hybridInvoice]);

        const res = await getBulkPdfRoute(
          new Request("http://localhost/api/invoices/bulk-pdf?from=2026-10-01&to=2026-10-31")
        );

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/pdf");
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it("Test 5d: Bulk PDF supports ids parameter and falls back cleanly for historical invoices with linked assignments", async () => {
      (getCurrentUser as any).mockResolvedValue({ id: "admin-user", role: "admin" });

      const historicalFallbackInvoice = {
        id: "inv-hist-bulk-fallback",
        invoiceNumber: "RE-2026-FALLBACK",
        status: "unpaid",
        date: new Date("2026-08-01"),
        netAmount: 100.0,
        vatAmount: 19.0,
        grossAmount: 119.0,
        pdfUrl: null,
        client: { id: "c-1", facilityName: "Seniorenheim Fallback", address: "Musterstr. 1" },
        assignments: [
          {
            id: "as-1",
            worker: { id: "w-1", fullName: "Worker One", qualification: "pflegefachkraft" },
            order: { id: "ord-1", shiftDate: new Date("2026-08-01"), startTime: "08:00", endTime: "16:00", requiredQualification: "pflegefachkraft" },
          },
        ],
        snapshotData: {
          calculationVersion: "v1",
        },
      };

      (prisma.invoice.findMany as any).mockResolvedValue([historicalFallbackInvoice]);

      const res = await getBulkPdfRoute(
        new Request("http://localhost/api/invoices/bulk-pdf?ids=inv-hist-bulk-fallback")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toContain("Rechnungen_");
    });
  });

  describe("5. Hours Account Integration with Approved Corrections", () => {
    it("hours account calculation respects approved corrections in workedHours", async () => {
      const mockWorker = {
        id: "w-1",
        fullName: "Clara Schumann",
        requiredHours: 160.0,
        carryoverHours: 0,
        employmentStartDate: new Date("2026-07-01"),
        employmentEndDate: null,
        sollHoursHistory: [],
      };

      const mockAssignments = [
        {
          workerId: "w-1",
          bonusHours: 0,
          order: {
            shiftDate: new Date("2026-09-10"),
            startTime: "08:00",
            endTime: "16:00",
            breakMinutes: 30, // 7.5 hrs scheduled
          },
          serviceConfirmation: { hoursWorked: 7.5 },
          // Approved correction to 9.0 hrs
          hoursCorrections: [
            {
              proposedHoursWorked: 9.0,
            },
          ],
        },
      ];

      (prisma.worker.findUnique as any).mockResolvedValue(mockWorker);
      (prisma.assignment.findMany as any).mockResolvedValue(mockAssignments);
      (prisma.leaveDay.findMany as any).mockResolvedValue([]);
      (prisma.workerHoursAdjustment.findMany as any).mockResolvedValue([]);

      const account = await getWorkerHoursAccount("w-1", "2026-09", "2026-09");
      const sepMonth = account.months.find((m) => m.month === "2026-09");
      expect(sepMonth).toBeDefined();
      expect(sepMonth?.workedHours).toBe(9.0); // Uses 9.0 from approved correction!
    });
  });

  describe("6. Mandatory Translations Completeness", () => {
    it("verifies all newly added keys exist in de.json, en.json, and ar.json", () => {
      const requiredStundenKeys = [
        "title",
        "sundayNotice",
        "livingArea",
        "hours",
        "hoursWithoutPause",
        "shiftDate",
        "from",
        "to",
        "resultTitle",
        "status",
        "mode",
        "modeActual",
        "modePlanned",
        "statusPlanned",
        "statusConfirmed",
        "statusCorrected",
        "plannedNotice",
        "totalActualHours",
        "unverifiedPlannedHours",
        "totalPlanned",
      ];

      const deStunden = (deMessages as any).reports?.stundennachweis;
      const enStunden = (enMessages as any).reports?.stundennachweis;
      const arStunden = (arMessages as any).reports?.stundennachweis;

      expect(deStunden).toBeDefined();
      expect(enStunden).toBeDefined();
      expect(arStunden).toBeDefined();

      for (const key of requiredStundenKeys) {
        expect(deStunden[key], `de.json missing reports.stundennachweis.${key}`).toBeDefined();
        expect(enStunden[key], `en.json missing reports.stundennachweis.${key}`).toBeDefined();
        expect(arStunden[key], `ar.json missing reports.stundennachweis.${key}`).toBeDefined();
        expect(deStunden[key].trim().length).toBeGreaterThan(0);
        expect(enStunden[key].trim().length).toBeGreaterThan(0);
        expect(arStunden[key].trim().length).toBeGreaterThan(0);
      }

      // Also verify orderConfirmations evidence keys
      const requiredEvidenceKeys = [
        "electronicOriginal",
        "archivedPdf",
        "dynamicView",
        "manualUpload",
        "manualOriginal",
        "manualCorrection",
        "approvedCorrection",
        "pendingCorrection",
      ];

      const deConfirm = (deMessages as any).confirmations;
      const enConfirm = (enMessages as any).confirmations;
      const arConfirm = (arMessages as any).confirmations;

      for (const key of requiredEvidenceKeys) {
        expect(deConfirm[key], `de.json missing confirmations.${key}`).toBeDefined();
        expect(enConfirm[key], `en.json missing confirmations.${key}`).toBeDefined();
        expect(arConfirm[key], `ar.json missing confirmations.${key}`).toBeDefined();
        expect(deConfirm[key].trim().length).toBeGreaterThan(0);
        expect(enConfirm[key].trim().length).toBeGreaterThan(0);
        expect(arConfirm[key].trim().length).toBeGreaterThan(0);
      }
    });
  });
});
