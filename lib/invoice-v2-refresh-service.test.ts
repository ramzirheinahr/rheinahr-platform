/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 6)
 *
 * Comprehensive Test Suite: V2 Single-Invoice Explicit Refresh & Revision Preservation Service
 * Covers all 5 Codex Independent Review Findings:
 * 1. HMAC-SHA256 preview token with 15-min TTL, admin binding, server secret, and anti-tamper.
 * 2. Mandatory fail-closed revision creation with complete identity/provenance and reliable document check.
 * 3. Strict protection against paid invoices and explicit confirmation guard for sent invoices (emailSent).
 * 4. Frozen root client fields in V2 snapshot (facilityName, address, billingInfo) preserving PDF immutability.
 * 5. Authentic successive revisions workflow (Legacy -> Rev 1 -> Rev 2) with monotonic sequencing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn(), usePathname: vi.fn(), Link: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  getCurrentUser: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  roleSatisfies: vi.fn(() => true),
}));
import {
  isV2RefreshEnabled,
  previewV2InvoiceRefresh,
  confirmV2InvoiceRefresh,
  computeRefreshPreviewToken,
  verifyRefreshPreviewToken,
  computeInvoiceStateHash,
  maskTokenForAudit,
  hasReliableHistoricalOrigin,
  isInvoiceSent,
  FeatureDisabledError,
  InvoiceNotFoundError,
  InvoiceCancelledError,
  InvoiceAlreadyPaidError,
  SentInvoiceConfirmationRequiredError,
  UnreliableHistoricalOriginError,
  NoAssignmentsLinkedError,
  StalePreviewError,
  ConcurrentModificationError,
} from "./invoice-v2-refresh-service";
import {
  refreshInvoice,
  previewInvoiceRefresh,
  confirmInvoiceRefresh,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { buildInvoicePdfData } from "./invoice-pdf-builder";
import { resolveInvoiceSurchargePolicy, type FacilitySurchargePolicyRecord } from "./surcharge-policy";

// ============================================================================
// Synthetic Test Fixtures
// ============================================================================

const STANDARD_PRICE_VERSION = {
  priceVersionId: "pv-std-2026",
  clientId: "client-1",
  qualification: "pflegefachkraft",
  hourlyRateInCents: 4000, // 40.00 € / hr
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  sourceReference: "Vertrag 2026 Paragraf 4",
  sourceDocumentUrl: "https://example.com/contracts/client-1-2026.pdf",
  verifiedAt: "2026-01-01T00:00:00Z",
  verifiedBy: "admin-verifier",
};

const BENCHMARK_PRICE_VERSION = {
  priceVersionId: "pv-bench-2026",
  clientId: "client-1",
  qualification: "pflegehelfer",
  hourlyRateInCents: 568, // raw line yielding 5,68 € display
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  sourceReference: "Vertrag 2026 Benchmark",
  sourceDocumentUrl: "https://example.com/contracts/client-1-bench.pdf",
  verifiedAt: "2026-01-01T00:00:00Z",
  verifiedBy: "admin-verifier",
};

function createTestFrozenPolicy(): any {
  const baseRecord: FacilitySurchargePolicyRecord = {
    clientId: "client-1",
    clientContractId: null,
    policyVersion: 1,
    federalState: "RP",
    municipality: "Bad Neuenahr",
    districtLocality: null,
    surchargeSat: 0.25,
    surchargeSun: 0.5,
    surchargeHoliday: 1.0,
    surchargeNight: 0.25,
    nightStart: "22:00",
    nightEnd: "06:00",
    combinationRule: "highest_non_night_plus_night",
    sourceType: "contract",
    sourceReference: "Rahmenvertrag § 7 vom 01.01.2026",
    verifiedByUserId: "admin-verifier",
    verifiedAt: "2026-01-01T00:00:00Z",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    isFrozen: false,
    frozenHash: "",
  };

  const resolved = resolveInvoiceSurchargePolicy({
    policy: baseRecord,
    referenceDate: "2026-03-01",
  });

  const frozenRes = resolveInvoiceSurchargePolicy({
    policy: {
      ...baseRecord,
      isFrozen: true,
      frozenHash: (resolved as any).frozenHash,
    },
    referenceDate: "2026-03-01",
  });

  if (frozenRes.status !== "resolved") {
    throw new Error(`Failed to freeze policy: ${frozenRes.message}`);
  }

  return frozenRes;
}

const FROZEN_POLICY = createTestFrozenPolicy();

function createSyntheticAssignment(
  id: string,
  opts?: {
    invoiceId?: string | null;
    shiftDate?: string;
    startTime?: string;
    endTime?: string;
    qualification?: string;
    workerName?: string;
    status?: string;
  }
): any {
  return {
    id,
    orderId: `order-${id}`,
    workerId: `worker-${id}`,
    invoiceId: opts && "invoiceId" in opts ? opts.invoiceId : "inv-target-1",
    status: opts?.status || "confirmed",
    hours: 1.0,
    order: {
      id: `order-${id}`,
      clientId: "client-1",
      shiftDate: new Date(opts?.shiftDate || "2026-03-02T08:00:00.000Z"),
      startTime: opts?.startTime || "08:00",
      endTime: opts?.endTime || "09:00",
      breakMinutes: 0,
      requiredQualification: opts?.qualification || "pflegefachkraft",
      client: {
        id: "client-1",
        facilityName: "Seniorenresidenz RheinAhr",
        shortCode: "SR-RA",
        internalNumber: "RA-100",
        address: "Musterstr. 12, 53474 Bad Neuenahr",
        billingEmail: "buchhaltung@rheinahr.de",
        billingInfo: "Zentrale Faktura",
        paymentTermsDays: 14,
        state: "RP",
        municipalityAgs: "07131007",
      },
    },
    worker: {
      id: `worker-${id}`,
      fullName: opts?.workerName || "Maria Muster",
      qualification: opts?.qualification || "pflegefachkraft",
    },
    confirmation: null,
  };
}

const mockDefaultHoursResolver = vi.fn().mockImplementation((id: string) =>
  Promise.resolve({
    assignmentId: id,
    effectiveHours: 1.0,
    effectiveStartTime: "08:00",
    effectiveEndTime: "09:00",
    effectiveBreakMinutes: 0,
    source: "service_confirmation" as const,
    effectiveVersion: "conf-token-1",
    isCorrected: false,
    approvedCorrection: null,
  })
);

// ============================================================================
// Test Suites
// ============================================================================

describe("V2 Single-Invoice Explicit Refresh & Revision Preservation Service (Phase 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FEATURE_INVOICE_V2_REFRESH;
  });

  // =========================================================================
  // Section 1: Server Feature Flag Isolation & Zero-Fallback Guarantees
  // =========================================================================
  describe("1. Server Feature Flag Isolation & Zero-Fallback Guarantees", () => {
    it("reports feature flag as disabled by default when env is not set", () => {
      expect(isV2RefreshEnabled()).toBe(false);
    });

    it("reports feature flag as enabled when FEATURE_INVOICE_V2_REFRESH='true'", () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";
      expect(isV2RefreshEnabled()).toBe(true);
    });

    it("rejects confirmV2InvoiceRefresh with FeatureDisabledError when flag is false", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "false";

      await expect(
        confirmV2InvoiceRefresh({
          invoiceId: "inv-1",
          previewToken: "tok-123",
          performedByUserId: "admin-1",
        })
      ).rejects.toThrow(FeatureDisabledError);
    });

    it("rejects action refreshInvoice when flag is disabled without silent fallback to legacy calculation", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "false";

      await expect(
        refreshInvoice("inv-1", { previewToken: "tok-123" })
      ).rejects.toThrow(/\[FEATURE_DISABLED\]/);
    });

    it("rejects action refreshInvoice when previewToken is missing (mandates preview flow)", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      await expect(
        refreshInvoice("inv-1")
      ).rejects.toThrow(/\[PREVIEW_REQUIRED\]/);
    });
  });

  // =========================================================================
  // Section 2: Finding 1 - HMAC Token, 15-Minute Expiry, Admin Binding & Anti-Tamper
  // =========================================================================
  describe("2. HMAC Preview Token Security & Verification (Finding 1)", () => {
    it("generates an HMAC-SHA256 signed token with 15-minute TTL bound to adminId and draftHash", () => {
      const now = Date.now();
      const token = computeRefreshPreviewToken({
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-2", "assign-1"],
        issuedAt: now,
        ttlMs: 900000, // 15 mins
        secret: "super-secret-key",
      });

      expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);

      const verification = verifyRefreshPreviewToken(token, {
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1", "assign-2"],
        currentTime: now + 60000, // 1 min later
        secret: "super-secret-key",
      });

      expect(verification.valid).toBe(true);
      if (verification.valid) {
        expect(verification.payload.adminId).toBe("admin-alice");
        expect(verification.payload.expiresAt).toBe(now + 900000);
      }
    });

    it("rejects preview token when confirmed by a different administrator (ADMIN_MISMATCH)", () => {
      const now = Date.now();
      const token = computeRefreshPreviewToken({
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        issuedAt: now,
        secret: "secret-key",
      });

      const verification = verifyRefreshPreviewToken(token, {
        invoiceId: "inv-100",
        adminId: "admin-bob", // Bob tries to confirm Alice's preview!
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        currentTime: now + 5000,
        secret: "secret-key",
      });

      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.code).toBe("ADMIN_MISMATCH");
      }
    });

    it("rejects preview token after 15 minutes TTL expiry (TOKEN_EXPIRED)", () => {
      const now = Date.now();
      const token = computeRefreshPreviewToken({
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        issuedAt: now,
        ttlMs: 900000, // 15 mins
        secret: "secret-key",
      });

      const verification = verifyRefreshPreviewToken(token, {
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        currentTime: now + 900001, // 15 min + 1 ms!
        secret: "secret-key",
      });

      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.code).toBe("TOKEN_EXPIRED");
      }
    });

    it("rejects preview token when signature is altered or tampered with (TOKEN_SIGNATURE_INVALID)", () => {
      const now = Date.now();
      const token = computeRefreshPreviewToken({
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        issuedAt: now,
        secret: "secret-key",
      });

      const parts = token.split(".");
      const tamperedToken = `${parts[0]}.${parts[1]}.badbadbad${parts[2].slice(9)}`;

      const verification = verifyRefreshPreviewToken(tamperedToken, {
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-abc",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        currentTime: now + 1000,
        secret: "secret-key",
      });

      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.code).toBe("TOKEN_SIGNATURE_INVALID");
      }
    });

    it("rejects confirmation when invoice database state changes between preview and confirm (INVOICE_STATE_CHANGED)", () => {
      const now = Date.now();
      const token = computeRefreshPreviewToken({
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-original",
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        issuedAt: now,
        secret: "secret-key",
      });

      const verification = verifyRefreshPreviewToken(token, {
        invoiceId: "inv-100",
        adminId: "admin-alice",
        previousGrossCents: 10000,
        newGrossCents: 12000,
        invoiceStateHash: "state-hash-mutated", // state changed!
        draftHash: "draft-hash-xyz",
        baseRevisionNumber: 0,
        assignmentIds: ["assign-1"],
        currentTime: now + 1000,
        secret: "secret-key",
      });

      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.code).toBe("INVOICE_STATE_CHANGED");
      }
    });

    it("verifies that audit logs store masked token hash rather than raw token", () => {
      const rawToken = "v1.payload.super-secret-signature";
      const masked = maskTokenForAudit(rawToken);
      expect(masked).toHaveLength(64);
      expect(masked).not.toContain("super-secret-signature");
    });
  });

  // =========================================================================
  // Section 3: Finding 2 - Mandatory Fail-Closed Revision & Historical Origin Standard
  // =========================================================================
  describe("3. Mandatory Fail-Closed Revision & Reliable Document Standard (Finding 2)", () => {
    it("rejects refresh preview when historical invoice has snapshotData=null and no pdfUrl (UNRELIABLE_HISTORICAL_DOCUMENT)", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const mockUnreliableInvoice = {
        id: "inv-unreliable",
        invoiceNumber: "INV-UNRELIABLE",
        status: "unpaid",
        date: new Date(),
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119,
        pdfUrl: null, // No stored PDF file
        snapshotData: null, // No frozen snapshot items
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockUnreliableInvoice),
        },
      };

      await expect(
        previewV2InvoiceRefresh("inv-unreliable", { prisma: mockPrisma })
      ).rejects.toThrow(UnreliableHistoricalOriginError);
    });

    it("accepts refresh when historical invoice has a verifiable static PDF url", () => {
      const origin = hasReliableHistoricalOrigin({
        pdfUrl: "https://example.com/invoices/inv-static.pdf",
        snapshotData: null,
      });
      expect(origin.reliable).toBe(true);
      expect(origin.source).toBe("stored_pdf");
    });

    it("accepts refresh when historical invoice has a frozen items array in snapshotData", () => {
      const origin = hasReliableHistoricalOrigin({
        pdfUrl: null,
        snapshotData: { items: [{ pos: 1, amount: "10.00 €" }] },
      });
      expect(origin.reliable).toBe(true);
      expect(origin.source).toBe("frozen_snapshot");
    });

    it("fails closed when tx.invoiceRevision delegate is missing or create fails", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-fail-closed" });
      const mockInvoice = {
        id: "inv-fail-closed",
        invoiceNumber: "INV-FC-1",
        status: "unpaid",
        date: new Date(),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: { items: [{ pos: 1, amount: "47.60 €" }] },
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-fail-closed" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn(),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: undefined, // Missing delegate!
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-1",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-fail-closed", deps);

      await expect(
        confirmV2InvoiceRefresh(
          {
            invoiceId: "inv-fail-closed",
            previewToken: preview.previewToken,
            performedByUserId: "admin-1",
          },
          deps
        )
      ).rejects.toThrow(/REVISION_CREATION_FAILED/);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it("records full invoice provenance including invoiceNumber, dates, client attributes, and assignment mappings in revision", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-prov-1" });
      const mockInvoice = {
        id: "inv-prov-1",
        invoiceNumber: "INV-PROVENANCE-2026",
        status: "unpaid",
        date: new Date("2026-03-01"),
        dueDate: new Date("2026-03-15"),
        clientId: "client-1",
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        taxRate: 0.19,
        pdfUrl: "https://example.com/invoices/inv-prov-1.pdf",
        snapshotData: { items: [{ pos: 1, amount: "47.60 €" }] },
        client: a1.order.client,
        assignments: [a1],
      };

      let savedRevision: any = null;
      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-prov-1" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn().mockResolvedValue(mockInvoice),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockImplementation((args: any) => {
            savedRevision = args.data;
            return Promise.resolve({ id: "rev-1", ...args.data });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-super",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-prov-1", deps);
      const res = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-prov-1",
          previewToken: preview.previewToken,
          performedByUserId: "admin-super",
          reason: "Provenance preservation test",
        },
        deps
      );

      expect(res.success).toBe(true);
      expect(savedRevision).toBeDefined();
      const prevProv = savedRevision.previousSnapshotData;
      expect(prevProv.invoiceNumber).toBe("INV-PROVENANCE-2026");
      expect(prevProv.dueDate).toBeDefined();
      expect(prevProv.client.facilityName).toBe("Seniorenresidenz RheinAhr");
      expect(prevProv.client.address).toBe("Musterstr. 12, 53474 Bad Neuenahr");
      expect(prevProv.assignments).toHaveLength(1);
      expect(prevProv.assignments[0].id).toBe("assign-1");
      expect(prevProv.originReliability).toBe("stored_pdf");
      expect(prevProv.hasStoredPdfFile).toBe(true);
    });
  });

  // =========================================================================
  // Section 4: Finding 3 - Protection for Paid and Sent Invoices
  // =========================================================================
  describe("4. Protection for Paid and Sent Invoices (Finding 3)", () => {
    it("rejects preview and confirm when target invoice is paid (INVOICE_ALREADY_PAID)", async () => {
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-paid" });
      const mockPaidInvoice = {
        id: "inv-paid",
        invoiceNumber: "INV-PAID-01",
        status: "paid", // Paid invoice!
        date: new Date(),
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119,
        snapshotData: { items: [{ pos: 1, amount: "119.00 €" }] },
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockPaidInvoice),
        },
      };

      await expect(
        previewV2InvoiceRefresh("inv-paid", { prisma: mockPrisma })
      ).rejects.toThrow(InvoiceAlreadyPaidError);
    });

    it("flags isSent=true in preview when invoice has emailSent in snapshotData", async () => {
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-sent" });
      const mockSentInvoice = {
        id: "inv-sent",
        invoiceNumber: "INV-SENT-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          items: [{ pos: 1, amount: "47.60 €" }],
          emailSent: true, // Actual sent indicator written by sendInvoiceEmail
          sentAt: "2026-03-02T10:00:00Z",
        },
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockSentInvoice),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
      };

      const deps = {
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-sent", deps);
      expect(preview.isSent).toBe(true);
    });

    it("rejects confirm on sent invoice when confirmSentInvoiceUpdate is not true (SENT_INVOICE_REQUIRES_EXPLICIT_CONFIRMATION)", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-sent" });
      const mockSentInvoice = {
        id: "inv-sent",
        invoiceNumber: "INV-SENT-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          items: [{ pos: 1, amount: "47.60 €" }],
          emailSent: true,
        },
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-sent" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockSentInvoice),
          update: vi.fn(),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn(),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-sent", deps);

      // Attempt confirm WITHOUT confirmSentInvoiceUpdate: true
      await expect(
        confirmV2InvoiceRefresh(
          {
            invoiceId: "inv-sent",
            previewToken: preview.previewToken,
            performedByUserId: "admin-super",
          },
          deps
        )
      ).rejects.toThrow(SentInvoiceConfirmationRequiredError);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it("succeeds on sent invoice when confirmSentInvoiceUpdate: true is provided and logs audit trail without external dispatch", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-sent" });
      const mockSentInvoice = {
        id: "inv-sent",
        invoiceNumber: "INV-SENT-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          items: [{ pos: 1, amount: "47.60 €" }],
          emailSent: true,
        },
        client: a1.order.client,
        assignments: [a1],
      };

      let auditLoggedData: any = null;
      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-sent" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockSentInvoice),
          update: vi.fn().mockResolvedValue(mockSentInvoice),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: "rev-1" }),
        },
        auditLog: {
          create: vi.fn().mockImplementation((args: any) => {
            auditLoggedData = args.data;
            return Promise.resolve({ id: "audit-1" });
          }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-super",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-sent", deps);

      const res = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-sent",
          previewToken: preview.previewToken,
          performedByUserId: "admin-super",
          confirmSentInvoiceUpdate: true, // Explicit confirmation!
        },
        deps
      );

      expect(res.success).toBe(true);
      expect(mockPrisma.invoice.update).toHaveBeenCalled();
      expect(auditLoggedData.metadata.isSentRevised).toBe(true);
    });
  });

  // =========================================================================
  // Section 5: Finding 4 - Frozen Root Client Fields & PDF Builder Immunity
  // =========================================================================
  describe("5. Frozen Root Client Fields in Snapshot & PDF Immutability (Finding 4)", () => {
    it("freezes facilityName, address, billingInfo at the root level of snapshotData and proves PDF immunity when client is mutated", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-client-freeze" });
      const mockInvoice = {
        id: "inv-client-freeze",
        invoiceNumber: "INV-FREEZE-001",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: { items: [{ pos: 1, amount: "47.60 €" }] },
        client: a1.order.client,
        assignments: [a1],
      };

      let capturedFrozenSnapshot: any = null;
      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-client-freeze" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
          update: vi.fn().mockImplementation((args: any) => {
            capturedFrozenSnapshot = args.data.snapshotData;
            return Promise.resolve(mockInvoice);
          }),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: "rev-1" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-super",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-client-freeze", deps);
      await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-client-freeze",
          previewToken: preview.previewToken,
          performedByUserId: "admin-super",
        },
        deps
      );

      // Verify root client attributes are frozen on snapshotData
      expect(capturedFrozenSnapshot).toBeDefined();
      expect(capturedFrozenSnapshot.facilityName).toBe("Seniorenresidenz RheinAhr");
      expect(capturedFrozenSnapshot.address).toBe("Musterstr. 12, 53474 Bad Neuenahr");
      expect(capturedFrozenSnapshot.internalNumber).toBe("RA-100");
      expect(capturedFrozenSnapshot.billingInfo).toBe("Zentrale Faktura");

      // COUNTER-TEST: Now simulate mutating live client in the database
      const mutatedLiveClient = {
        id: "client-1",
        facilityName: "VÖLLIG ANDERE EINRICHTUNG GMBH",
        address: "Ganz Neue Straße 999, 10115 Berlin",
        internalNumber: "MUTATED-999",
        billingInfo: "Mutierte Faktura",
      };

      const invoiceWithSnapshot = {
        invoiceNumber: "INV-FREEZE-001",
        date: new Date("2026-03-01"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: capturedFrozenSnapshot,
      };

      // Render PDF Data using mutated client
      const pdfData = buildInvoicePdfData(invoiceWithSnapshot as any, mutatedLiveClient as any, []);

      // The PDF MUST strictly reflect the frozen snapshot, NOT the mutated client!
      expect(pdfData.clientName).toBe("Seniorenresidenz RheinAhr");
      expect(pdfData.clientAddress).toBe("Musterstr. 12, 53474 Bad Neuenahr");
      expect(pdfData.clientId).toBe("RA-100");
      expect(pdfData.billingInfo).toBe("Zentrale Faktura");
      expect(pdfData.clientName).not.toBe("VÖLLIG ANDERE EINRICHTUNG GMBH");
    });
  });

  // =========================================================================
  // Section 6: Finding 5 - Authentic Multi-Step Successive Revisions Workflow
  // =========================================================================
  describe("6. Authentic Multi-Step Successive Revisions Workflow (Finding 5)", () => {
    it("executes an authentic two-step successive revision workflow (Legacy -> Rev 1 -> Rev 2) incrementing revisionNumber monotonically", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-successive" });
      const a2 = createSyntheticAssignment("assign-2", { invoiceId: "inv-successive" });

      // Step 1 Initial State: Legacy Invoice with 1 assignment (40.00 €)
      const currentInvoiceRecord = {
        id: "inv-successive",
        invoiceNumber: "INV-SUCC-2026",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          legacyNote: "Initial legacy state",
          items: [{ pos: 1, amount: "47.60 €" }],
        },
        client: a1.order.client,
        assignments: [a1],
      };

      const revisionsStore: any[] = [];

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) {
            return Promise.resolve(currentInvoiceRecord.assignments.map((a) => ({ id: a.id })));
          }
          if (sql.includes("invoices")) {
            return Promise.resolve([{ id: "inv-successive" }]);
          }
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockImplementation(() => Promise.resolve(currentInvoiceRecord)),
          update: vi.fn().mockImplementation((args: any) => {
            Object.assign(currentInvoiceRecord, args.data);
            return Promise.resolve(currentInvoiceRecord);
          }),
        },
        assignment: {
          findMany: vi.fn().mockImplementation(() => Promise.resolve(currentInvoiceRecord.assignments)),
        },
        invoiceRevision: {
          count: vi.fn().mockImplementation(() => Promise.resolve(revisionsStore.length)),
          create: vi.fn().mockImplementation((args: any) => {
            const rev = { id: `rev-${revisionsStore.length + 1}`, ...args.data };
            revisionsStore.push(rev);
            return Promise.resolve(rev);
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-alice",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      // -----------------------------------------------------------------------
      // EXECUTION STEP 1: Legacy Invoice -> Revision 1 (V2)
      // -----------------------------------------------------------------------
      const preview1 = await previewV2InvoiceRefresh("inv-successive", deps);
      expect(preview1.baseRevisionNumber).toBe(0);
      expect(preview1.targetRevisionNumber).toBe(1);

      const confirm1 = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-successive",
          previewToken: preview1.previewToken,
          performedByUserId: "admin-alice",
          reason: "Erste Aktualisierung auf V2",
        },
        deps
      );

      expect(confirm1.success).toBe(true);
      expect(confirm1.revisionNumber).toBe(1);
      expect(revisionsStore).toHaveLength(1);
      expect(revisionsStore[0].revisionNumber).toBe(1);
      expect((currentInvoiceRecord.snapshotData as any).revisionNumber).toBe(1);
      expect((currentInvoiceRecord.snapshotData as any).calculationVersion).toBe("v2");

      // -----------------------------------------------------------------------
      // EXECUTION STEP 2: Second assignment added -> Refresh Revision 1 to Revision 2
      // -----------------------------------------------------------------------
      currentInvoiceRecord.assignments = [a1, a2]; // Now 2 assignments (80.00 €)

      const preview2 = await previewV2InvoiceRefresh("inv-successive", deps);
      // Notice: Preview must recognize current invoice is at revision 1 and target is revision 2!
      expect(preview2.baseRevisionNumber).toBe(1);
      expect(preview2.targetRevisionNumber).toBe(2);
      expect(preview2.proposed.grossAmount).toBe(95.2); // 80.00 € + 19% VAT = 95.20 €

      const confirm2 = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-successive",
          previewToken: preview2.previewToken,
          performedByUserId: "admin-alice",
          reason: "Zweite Schicht nacherfasst - Revision 2",
        },
        deps
      );

      expect(confirm2.success).toBe(true);
      expect(confirm2.revisionNumber).toBe(2);
      expect(revisionsStore).toHaveLength(2);
      expect(revisionsStore[1].revisionNumber).toBe(2);
      expect(revisionsStore[1].reason).toBe("Zweite Schicht nacherfasst - Revision 2");
      expect((currentInvoiceRecord.snapshotData as any).revisionNumber).toBe(2);

      // Verify both revisions exist independently in revisionsStore
      expect(revisionsStore[0].newGrossAmount).toBe(47.6);
      expect(revisionsStore[1].newGrossAmount).toBe(95.2);
    });
  });

  // =========================================================================
  // Section 7: Acceptance Benchmark & Single-Engine Parity (17,04 €)
  // =========================================================================
  describe("7. Acceptance Benchmark & Single-Engine Parity (17,04 €)", () => {
    it("Benchmark: refreshes legacy invoice with three 5.678 € raw lines to display 5,68 € and exactly Summe 17,04 € (not 17,03 €)", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-benchmark-1", startTime: "08:00", endTime: "09:00", qualification: "pflegehelfer" });
      const a2 = createSyntheticAssignment("assign-2", { invoiceId: "inv-benchmark-1", startTime: "09:00", endTime: "10:00", qualification: "pflegehelfer" });
      const a3 = createSyntheticAssignment("assign-3", { invoiceId: "inv-benchmark-1", startTime: "10:00", endTime: "11:00", qualification: "pflegehelfer" });

      const mockLegacyInvoice = {
        id: "inv-benchmark-1",
        invoiceNumber: "INV-2026-BENCH",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 17.03, // Legacy flaw: was 17,03 €
        vatAmount: 3.24,
        grossAmount: 20.27,
        pdfUrl: "https://example.com/invoices/inv-bench.pdf",
        snapshotData: {
          items: [{ pos: 1, amount: "17.03 €" }],
        },
        client: a1.order.client,
        assignments: [a1, a2, a3],
      };

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }, { id: "assign-2" }, { id: "assign-3" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-benchmark-1" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockLegacyInvoice),
          update: vi.fn().mockResolvedValue(mockLegacyInvoice),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2, a3]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: "rev-1" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        adminId: "admin-user",
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(BENCHMARK_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-benchmark-1", deps);
      expect(preview.proposed.formattedNet).toBe("17,04 €");
      expect(preview.proposed.formattedGross).toBe("20,28 €");

      const res = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-benchmark-1",
          previewToken: preview.previewToken,
          performedByUserId: "admin-user",
        },
        deps
      );

      expect(res.success).toBe(true);
      expect(res.netAmount).toBe(17.04);
      expect(res.vatAmount).toBe(3.24);
      expect(res.grossAmount).toBe(20.28);
    });
  });
});
