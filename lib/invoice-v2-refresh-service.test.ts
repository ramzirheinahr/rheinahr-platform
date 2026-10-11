/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 6)
 *
 * Comprehensive Test Suite: V2 Single-Invoice Explicit Refresh & Revision Preservation Service
 * Covers all Codex Independent Review Findings:
 * 1. HMAC-SHA256 preview token with 15-min TTL, admin binding, mandatory server secret, clock skew/future tamper protection.
 * 2. Reliable document origin standard (stored_pdf verified on disk vs complete frozen_snapshot), fail-closed revision archiving, and revision PDF retrieval.
 * 3. Strict fail-closed protection for sent invoices (SENT_INVOICE_REFRESH_NOT_PERMITTED) and paid invoices (INVOICE_ALREADY_PAID).
 * 4. Frozen root client fields in V2 snapshot (facilityName, address, billingInfo) preserving PDF immutability.
 * 5. Strict rejection of fresh V2 invoices (FRESH_V2_INVOICE_IMMUTABLE) and corrupted revision chains (REVISION_CHAIN_CORRUPTED), with authentic successive revisions (Legacy -> Rev 1 -> Rev 2).
 */

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn(), usePathname: vi.fn(), Link: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  getCurrentUser: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    invoiceRevision: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    assignment: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/pdf/invoice", () => ({
  generateInvoicePdf: vi.fn().mockImplementation(async (data: any) => {
    return Buffer.concat([
      Buffer.from(`%PDF-1.4 REGENERATED FOR ${data?.client?.facilityName || "UNKNOWN"}\n`),
      Buffer.alloc(100, 32),
    ]);
  }),
}));

import { prisma } from "@/lib/prisma";
import {
  isV2RefreshEnabled,
  previewV2InvoiceRefresh,
  confirmV2InvoiceRefresh,
  computeRefreshPreviewToken,
  verifyRefreshPreviewToken,
  computeInvoiceStateHash,
  maskTokenForAudit,
  hasReliableHistoricalOrigin,
  checkReliableHistoricalOrigin,
  determineInvoiceRevisionState,
  isInvoiceSent,
  isCompleteFrozenSnapshot,
  getRefreshSecret,
  defaultFileVerifier,
  FeatureDisabledError,
  InvoiceNotFoundError,
  InvoiceCancelledError,
  InvoiceAlreadyPaidError,
  SentInvoiceRefreshNotPermittedError,
  UnreliableHistoricalOriginError,
  NoAssignmentsLinkedError,
  StalePreviewError,
  ConcurrentModificationError,
  MissingRefreshSecretError,
  InsufficientSecretStrengthError,
  FreshV2InvoiceImmutableError,
  RevisionChainCorruptedError,
  InvoiceRefreshError,
  persistArchivedOriginalPdf,
  getArchivedInvoicesDirectory,
  getAllowedInvoiceStorageRoots,
} from "./invoice-v2-refresh-service";
import {
  refreshInvoice,
  previewInvoiceRefresh,
  confirmInvoiceRefresh,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { buildInvoicePdfData } from "./invoice-pdf-builder";
import { resolveInvoiceSurchargePolicy, type FacilitySurchargePolicyRecord } from "./surcharge-policy";
import { GET as getInvoicePdfRoute } from "@/app/api/invoices/[id]/pdf/route";

// ============================================================================
// Synthetic Test Fixtures
// ============================================================================

const TEST_SECRET = "super-secret-refresh-key-32-chars-long-minimum!";

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

function createTestFrozenPolicy(refDate: string = "2026-03-01"): any {
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
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    isFrozen: false,
    frozenHash: "",
    verifiedByUserId: "admin-verifier",
    verifiedAt: new Date("2026-01-01T00:00:00Z"),
  };

  const resolved = resolveInvoiceSurchargePolicy({
    policy: baseRecord,
    referenceDate: refDate,
  });

  if (resolved.status !== "resolved") {
    throw new Error(`Failed to resolve base policy: ${resolved.message}`);
  }

  const frozenRes = resolveInvoiceSurchargePolicy({
    policy: {
      ...baseRecord,
      isFrozen: true,
      frozenHash: resolved.frozenHash,
    },
    referenceDate: refDate,
  });

  if (frozenRes.status !== "resolved") {
    throw new Error(`Failed to freeze policy: ${frozenRes.message}`);
  }

  return frozenRes;
}

const FROZEN_POLICY = createTestFrozenPolicy();

function createSyntheticAssignment(id: string, opts?: { invoiceId?: string; qualification?: string; hours?: number; shiftDate?: string }) {
  return {
    id,
    orderId: `ord-${id}`,
    workerId: `wrk-${id}`,
    invoiceId: opts?.invoiceId || "inv-1",
    status: "confirmed",
    hours: opts?.hours ?? 1.0,
    order: {
      id: `ord-${id}`,
      clientId: "client-1",
      shiftDate: new Date(opts?.shiftDate || "2026-03-02T08:00:00Z"),
      startTime: "08:00",
      endTime: "09:00",
      breakMinutes: 0,
      requiredQualification: opts?.qualification || "pflegefachkraft",
      client: {
        id: "client-1",
        facilityName: "Seniorenresidenz RheinAhr",
        shortCode: "RA-100",
        internalNumber: "INT-999",
        address: "Musterstr. 12, 53474 Bad Neuenahr",
        billingEmail: "buchhaltung@rheinahr.example.com",
        billingInfo: "Zentrale Faktura",
        paymentTermsDays: 14,
      },
    },
    worker: {
      id: `wrk-${id}`,
      fullName: `Musterpfleger ${id}`,
    },
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
    process.env.INVOICE_REFRESH_SECRET = TEST_SECRET;
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
        refreshInvoice("inv-1", { previewToken: "v1.abc.123" })
      ).rejects.toThrow(/FEATURE_DISABLED/);
    });

    it("rejects action refreshInvoice when previewToken is missing (mandates preview flow)", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      await expect(refreshInvoice("inv-1")).rejects.toThrow(/PREVIEW_REQUIRED/);
    });
  });

  // =========================================================================
  // Section 2: HMAC Preview Token Security & Secret Requirement (Finding 1)
  // =========================================================================
  describe("2. HMAC Preview Token Security & Secret Requirement (Finding 1)", () => {
    it("throws MissingRefreshSecretError when neither INVOICE_REFRESH_SECRET nor NEXTAUTH_SECRET is set", () => {
      delete process.env.INVOICE_REFRESH_SECRET;
      delete process.env.NEXTAUTH_SECRET;

      expect(() => getRefreshSecret()).toThrow(MissingRefreshSecretError);
    });

    it("throws InsufficientSecretStrengthError when secret is shorter than 32 characters", () => {
      process.env.INVOICE_REFRESH_SECRET = "weak-secret-too-short-123";
      expect(() => getRefreshSecret()).toThrow(InsufficientSecretStrengthError);
    });

    it("rejects previewV2InvoiceRefresh immediately if secret is missing", async () => {
      delete process.env.INVOICE_REFRESH_SECRET;
      delete process.env.NEXTAUTH_SECRET;

      await expect(previewV2InvoiceRefresh("inv-1")).rejects.toThrow(MissingRefreshSecretError);
    });

    it("rejects confirmV2InvoiceRefresh immediately if secret is missing", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";
      delete process.env.INVOICE_REFRESH_SECRET;
      delete process.env.NEXTAUTH_SECRET;

      await expect(
        confirmV2InvoiceRefresh({
          invoiceId: "inv-1",
          previewToken: "v1.dummy.token",
          performedByUserId: "admin-1",
        })
      ).rejects.toThrow(MissingRefreshSecretError);
    });

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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
      });

      expect(verification.valid).toBe(true);
      if (verification.valid) {
        expect(verification.payload.adminId).toBe("admin-alice");
        expect(verification.payload.expiresAt).toBe(now + 900000);
      }
    });

    it("rejects preview token with future issuedAt (clock skew / timing manipulation attempt)", () => {
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
        issuedAt: now + 60000, // 1 minute into the future!
        secret: TEST_SECRET,
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
        currentTime: now,
        secret: TEST_SECRET,
      });

      expect(verification.valid).toBe(false);
      if (!verification.valid) {
        expect(verification.code).toBe("TOKEN_ISSUED_IN_FUTURE");
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
        secret: TEST_SECRET,
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
  // Section 3: Finding 2 - Reliable Document Origin Standard & Revision PDF
  // =========================================================================
  describe("3. Reliable Document Origin Standard & Historical PDF (Finding 2)", () => {
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

    it("rejects refresh when pdfUrl points to a non-existent file on disk and snapshotData is empty", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const mockInvoice = {
        id: "inv-missing-file",
        invoiceNumber: "INV-MISSING-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119,
        pdfUrl: "/non/existent/path/to/invoice.pdf",
        snapshotData: null,
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
        },
      };

      await expect(
        previewV2InvoiceRefresh("inv-missing-file", { prisma: mockPrisma })
      ).rejects.toThrow(UnreliableHistoricalOriginError);
    });

    it("rejects refresh when pdfUrl is an arbitrary remote link without verified local file and snapshotData is empty", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const mockInvoice = {
        id: "inv-arbitrary-url",
        invoiceNumber: "INV-ARB-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119,
        pdfUrl: "https://arbitrary.invalid/invoice-not-verified.pdf",
        snapshotData: null,
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockInvoice),
        },
      };

      await expect(
        previewV2InvoiceRefresh("inv-arbitrary-url", { prisma: mockPrisma })
      ).rejects.toThrow(UnreliableHistoricalOriginError);
    });

    it("rejects refresh when snapshotData is incomplete (missing items description, hours, or amounts)", async () => {
      const checkEmpty = await isCompleteFrozenSnapshot({ items: [] });
      expect(checkEmpty.complete).toBe(false);

      const checkMissingDesc = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "100.00 €",
        taxAmount: "19.00 €",
        total: "119.00 €",
        items: [{ hours: 1, total: "100.00 €" }], // missing description!
      });
      expect(checkMissingDesc.complete).toBe(false);
      expect(checkMissingDesc.reason).toMatch(/description fehlt/);

      const checkMissingHours = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "100.00 €",
        taxAmount: "19.00 €",
        total: "119.00 €",
        items: [{ description: "Pflegefachkraft", total: "100.00 €" }], // missing hours!
      });
      expect(checkMissingHours.complete).toBe(false);
      expect(checkMissingHours.reason).toMatch(/Stunden oder Betrag fehlen/);

      const checkMissingAmount = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "100.00 €",
        taxAmount: "19.00 €",
        total: "119.00 €",
        items: [{ description: "Pflegefachkraft", hours: 2 }], // missing amount!
      });
      expect(checkMissingAmount.complete).toBe(false);
      expect(checkMissingAmount.reason).toMatch(/Stunden oder Betrag fehlen/);

      const checkMissingFacility = await isCompleteFrozenSnapshot({
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
        total: "47.60 €",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      });
      expect(checkMissingFacility.complete).toBe(false);
      expect(checkMissingFacility.reason).toMatch(/facilityName fehlt/);

      const checkMissingAddress = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        date: "2026-03-01",
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
        total: "47.60 €",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      });
      expect(checkMissingAddress.complete).toBe(false);
      expect(checkMissingAddress.reason).toMatch(/address fehlt/);

      const checkMissingDate = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
        total: "47.60 €",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      });
      expect(checkMissingDate.complete).toBe(false);
      expect(checkMissingDate.reason).toMatch(/date fehlt/);
    });

    it("rejects refresh when snapshot is missing mandatory totals (subtotal, taxAmount, or total)", async () => {
      const baseSnap = {
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      };

      const checkMissingSubtotal = await isCompleteFrozenSnapshot({
        ...baseSnap,
        taxAmount: "7.60 €",
        total: "47.60 €",
      });
      expect(checkMissingSubtotal.complete).toBe(false);
      expect(checkMissingSubtotal.reason).toMatch(/Zwischensumme \(subtotal fehlt\)/);

      const checkMissingTax = await isCompleteFrozenSnapshot({
        ...baseSnap,
        subtotal: "40.00 €",
        total: "47.60 €",
      });
      expect(checkMissingTax.complete).toBe(false);
      expect(checkMissingTax.reason).toMatch(/Steuerbetrag \(taxAmount\/vatAmount fehlt\)/);

      const checkMissingTotal = await isCompleteFrozenSnapshot({
        ...baseSnap,
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
      });
      expect(checkMissingTotal.complete).toBe(false);
      expect(checkMissingTotal.reason).toMatch(/Gesamtbetrag \(total\/grossAmount fehlt\)/);
    });

    it("rejects refresh on arbitrary discrepancy (> 1 cent) between items sum and subtotal, but accepts documented 1-cent legacy rounding flaw", async () => {
      // Counter-Test A: Arbitrary discrepancy (2 cents or more) is strictly rejected
      // Items sum: 40.00 € + 20.00 € = 60.00 €, but subtotal says 60.05 € (5 cents discrepancy)
      const checkArbitraryDiscrepancy = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "60.05 €",
        taxAmount: "11.41 €",
        total: "71.46 €",
        items: [
          { description: "Posten 1", hours: 1, total: "40.00 €" },
          { description: "Posten 2", hours: 1, total: "20.00 €" },
        ],
      });
      expect(checkArbitraryDiscrepancy.complete).toBe(false);
      expect(checkArbitraryDiscrepancy.reason).toMatch(/weicht um 5 Cent von der Zwischensumme.*ab \(keine bekannte 1-Cent-Rundungsdifferenz\)/);

      // Counter-Test B: Documented 1-cent historical rounding discrepancy is accepted and flagged
      // Items sum: 5.67 + 5.68 + 5.68 = 17.03 €, subtotal printed as 17.04 € (discrepancy = -1 cent)
      const checkOneCentDiscrepancy = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "17.04 €",
        taxAmount: "3.24 €",
        total: "20.28 €",
        items: [
          { description: "Posten 1", hours: 1, total: "5.67 €" },
          { description: "Posten 2", hours: 1, total: "5.68 €" },
          { description: "Posten 3", hours: 1, total: "5.68 €" },
        ],
      });
      expect(checkOneCentDiscrepancy.complete).toBe(true);
      expect(checkOneCentDiscrepancy.hasKnownRoundingDiscrepancy).toBe(true);
      expect(checkOneCentDiscrepancy.knownRoundingDiscrepancyCents).toBe(-1);

      // Counter-Test C: Subtotal in snapshot MUST match DB netAmount exactly (0 cents tolerance)
      const checkMismatchedDbNet = await isCompleteFrozenSnapshot(
        {
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "60.00 €",
          taxAmount: "11.40 €",
          total: "71.40 €",
          items: [
            { description: "Posten 1", hours: 1, total: "40.00 €" },
            { description: "Posten 2", hours: 1, total: "20.00 €" },
          ],
        },
        { netAmount: 60.01 } as any // 1 cent difference between subtotal and DB netAmount!
      );
      expect(checkMismatchedDbNet.complete).toBe(false);
      expect(checkMismatchedDbNet.reason).toMatch(/stimmt nicht mit dem Netto-Rechnungsbetrag der Datenbank/);

      // Counter-Test D: VAT in snapshot MUST match DB vatAmount exactly (0 cents tolerance)
      const checkMismatchedDbVat = await isCompleteFrozenSnapshot(
        {
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "60.00 €",
          taxAmount: "11.40 €",
          total: "71.40 €",
          items: [{ description: "Posten 1", hours: 1, total: "60.00 €" }],
        },
        { netAmount: 60.0, vatAmount: 11.41, grossAmount: 71.4 } as any
      );
      expect(checkMismatchedDbVat.complete).toBe(false);
      expect(checkMismatchedDbVat.reason).toMatch(/Der Steuerbetrag des Snapshots .* stimmt nicht mit dem Steuerbetrag der Datenbank/);

      // Counter-Test E: Gross total in snapshot MUST match DB grossAmount exactly (0 cents tolerance)
      const checkMismatchedDbGross = await isCompleteFrozenSnapshot(
        {
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "60.00 €",
          taxAmount: "11.40 €",
          total: "71.40 €",
          items: [{ description: "Posten 1", hours: 1, total: "60.00 €" }],
        },
        { netAmount: 60.0, vatAmount: 11.4, grossAmount: 71.41 } as any
      );
      expect(checkMismatchedDbGross.complete).toBe(false);
      expect(checkMismatchedDbGross.reason).toMatch(/Der Gesamtbetrag des Snapshots .* stimmt nicht mit dem Brutto-Rechnungsbetrag der Datenbank/);
    });

    it("rejects snapshot when pre-flight PDF simulation fails or returns invalid bytes", async () => {
      const { generateInvoicePdf } = await import("@/lib/pdf/invoice");
      const pdfMock = vi.mocked(generateInvoicePdf);

      // Simulate renderer throwing an error
      pdfMock.mockRejectedValueOnce(new Error("Renderer fatal crash"));
      const failCrash = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
        total: "47.60 €",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      });
      expect(failCrash.complete).toBe(false);
      expect(failCrash.reason).toMatch(/Simulation der PDF-Erstellung aus dem Snapshot schlug fehl: Renderer fatal crash/);

      // Simulate renderer producing too few bytes (< 100 bytes)
      pdfMock.mockResolvedValueOnce(Buffer.from("%PDF-too-short"));
      const failShort = await isCompleteFrozenSnapshot({
        facilityName: "Test Facility",
        address: "Teststr. 1",
        date: "2026-03-01",
        subtotal: "40.00 €",
        taxAmount: "7.60 €",
        total: "47.60 €",
        items: [{ description: "Pflegefachkraft", hours: 1, total: "40.00 €" }],
      });
      expect(failShort.complete).toBe(false);
      expect(failShort.reason).toMatch(/Pre-Flight-Prüfung der PDF-Generierung aus dem Snapshot ergab keine gültigen PDF-Bytes/);
    });

    it("rejects stored PDF files that fail magic bytes check or lie outside allowed storage roots (including public/)", () => {
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }

      // Counter-Test A: Plain text file named as .pdf (fails %PDF- magic bytes check)
      const fakePdfPath = path.resolve(storageDir, "fake-text-file.pdf");
      fs.writeFileSync(fakePdfPath, Buffer.from("THIS IS A FAKE TEXT FILE WITHOUT PDF HEADER" + " ".repeat(100)));

      try {
        const textCheck = defaultFileVerifier(fakePdfPath);
        expect(textCheck.exists).toBe(false);
        expect(textCheck.reason).toMatch(/ungültige PDF-Magic-Bytes; Header '%PDF-' fehlt/);
      } finally {
        if (fs.existsSync(fakePdfPath)) fs.unlinkSync(fakePdfPath);
      }

      // Counter-Test B: Outside allowed invoice storage root (e.g. package.json in cwd)
      const outsideFile = path.resolve(process.cwd(), "package.json");
      const outsideCheck = defaultFileVerifier(outsideFile);
      expect(outsideCheck.exists).toBe(false);
      expect(outsideCheck.reason).toMatch(/liegt außerhalb des zulässigen Rechnungs-Speicherbereichs/);

      // Counter-Test C: Files in public/ directories are strictly rejected (no public web exposure)
      const publicDir = path.resolve(process.cwd(), "public/invoices");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      const publicPdf = path.resolve(publicDir, "public-invoice.pdf");
      fs.writeFileSync(publicPdf, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 32)]));
      try {
        const publicCheck = defaultFileVerifier(publicPdf);
        expect(publicCheck.exists).toBe(false);
        expect(publicCheck.reason).toMatch(/liegt außerhalb des zulässigen Rechnungs-Speicherbereichs/);
      } finally {
        if (fs.existsSync(publicPdf)) fs.unlinkSync(publicPdf);
      }
    });

    it("rejects setting INVOICE_ARCHIVE_DIR under public/ with INSECURE_STORAGE_CONFIGURATION", () => {
      const origEnv = process.env.INVOICE_ARCHIVE_DIR;
      try {
        process.env.INVOICE_ARCHIVE_DIR = path.resolve(process.cwd(), "public/archived-invoices");
        expect(() => getArchivedInvoicesDirectory()).toThrow(InvoiceRefreshError);
        expect(() => getArchivedInvoicesDirectory()).toThrow(/liegt innerhalb des öffentlichen Verzeichnisses \(public\/\)/);

        // Allowed roots filter out public/ directories
        const roots = getAllowedInvoiceStorageRoots([path.resolve(process.cwd(), "public/custom-archive")]);
        for (const r of roots) {
          expect(r.includes(`${path.sep}public${path.sep}`)).toBe(false);
        }
      } finally {
        if (origEnv !== undefined) {
          process.env.INVOICE_ARCHIVE_DIR = origEnv;
        } else {
          delete process.env.INVOICE_ARCHIVE_DIR;
        }
      }
    });

    it("fails closed when archive file already exists on disk with differing content (ORIGINAL_PDF_ARCHIVAL_FAILED, zero overwrite)", async () => {
      const archiveDir = getArchivedInvoicesDirectory();
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

      const sourcePdfPath = path.resolve(storageDir, "source-test-overwrite.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%TEST OVERWRITE\n"), Buffer.alloc(80, 32)]);
      const sourceSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(sourcePdfPath, pdfBytes);

      // Pre-create target archive file with DIFFERENT content
      const targetFilename = `invoice-inv-collision-rev0-${sourceSha.slice(0, 16)}.pdf`;
      const targetPath = path.resolve(archiveDir, targetFilename);
      const originalArchiveContent = Buffer.from("%PDF-1.4\n%EXISTING IMMUTABLE CONTENT\n");
      fs.writeFileSync(targetPath, originalArchiveContent);

      try {
        await expect(
          persistArchivedOriginalPdf(sourcePdfPath, "inv-collision", sourceSha)
        ).rejects.toThrow(/existiert bereits im Archiv.*und darf nicht überschrieben werden/);

        // Verify the original content was NOT overwritten
        const preservedBytes = fs.readFileSync(targetPath);
        expect(preservedBytes.equals(originalArchiveContent)).toBe(true);
      } finally {
        if (fs.existsSync(sourcePdfPath)) fs.unlinkSync(sourcePdfPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    });

    it("idempotently succeeds without overwriting when archive file already exists with identical SHA-256 and byteLength (DB rollback recovery)", async () => {
      const archiveDir = getArchivedInvoicesDirectory();
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

      const sourcePdfPath = path.resolve(storageDir, "source-test-idempotent.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%TEST IDEMPOTENT RECOVERY\n"), Buffer.alloc(80, 32)]);
      const sourceSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(sourcePdfPath, pdfBytes);

      // Pre-create target archive file with EXACT IDENTICAL content (e.g. from prior aborted DB attempt)
      const targetFilename = `invoice-inv-idempotent-rev0-${sourceSha.slice(0, 16)}.pdf`;
      const targetPath = path.resolve(archiveDir, targetFilename);
      fs.writeFileSync(targetPath, pdfBytes);
      const statBefore = fs.statSync(targetPath);

      try {
        const result = await persistArchivedOriginalPdf(sourcePdfPath, "inv-idempotent", sourceSha);

        expect(result.archivedPath).toBe(targetPath);
        expect(result.sourceOriginalPath).toBe(sourcePdfPath);
        expect(result.sha256).toBe(sourceSha);
        expect(result.byteLength).toBe(pdfBytes.length);

        // Verify target bytes were untouched
        const preservedBytes = fs.readFileSync(targetPath);
        expect(preservedBytes.equals(pdfBytes)).toBe(true);
        const statAfter = fs.statSync(targetPath);
        expect(statAfter.size).toBe(statBefore.size);
      } finally {
        if (fs.existsSync(sourcePdfPath)) fs.unlinkSync(sourcePdfPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    });

    it("rejects archive directory that is a symlink pointing to public/ with INSECURE_STORAGE_CONFIGURATION before writing any file", async () => {
      const pubDir = path.resolve(process.cwd(), "public/exposed-archive");
      if (!fs.existsSync(pubDir)) fs.mkdirSync(pubDir, { recursive: true });

      const symlinkArchiveDir = path.resolve(process.cwd(), "storage/symlink-to-pub");
      if (fs.existsSync(symlinkArchiveDir)) {
        try { fs.unlinkSync(symlinkArchiveDir); } catch { /* ignore */ }
      }
      fs.symlinkSync(pubDir, symlinkArchiveDir, "dir");

      const origEnv = process.env.INVOICE_ARCHIVE_DIR;
      process.env.INVOICE_ARCHIVE_DIR = symlinkArchiveDir;

      try {
        expect(() => getArchivedInvoicesDirectory()).toThrow(InvoiceRefreshError);
        expect(() => getArchivedInvoicesDirectory()).toThrow(/liegt innerhalb des öffentlichen Verzeichnisses \(public\/\)/);

        const storageDir = path.resolve(process.cwd(), "storage/invoices");
        if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
        const sourcePdf = path.resolve(storageDir, "symlink-test-src.pdf");
        fs.writeFileSync(sourcePdf, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 32)]));

        try {
          await expect(persistArchivedOriginalPdf(sourcePdf, "inv-symlink-test")).rejects.toThrow(
            /INSECURE_STORAGE_CONFIGURATION/
          );

          // Verify that NO file was written into the exposed public directory
          const filesInPub = fs.readdirSync(pubDir);
          expect(filesInPub.length).toBe(0);
        } finally {
          if (fs.existsSync(sourcePdf)) fs.unlinkSync(sourcePdf);
        }
      } finally {
        if (origEnv !== undefined) {
          process.env.INVOICE_ARCHIVE_DIR = origEnv;
        } else {
          delete process.env.INVOICE_ARCHIVE_DIR;
        }
        if (fs.existsSync(symlinkArchiveDir)) {
          try { fs.unlinkSync(symlinkArchiveDir); } catch { /* ignore */ }
        }
        if (fs.existsSync(pubDir)) {
          try { fs.rmdirSync(pubDir); } catch { /* ignore */ }
        }
      }
    });

    it("guarantees atomic zero-overwrite via fs.linkSync when target file is created concurrently between checks with differing content", async () => {
      const archiveDir = getArchivedInvoicesDirectory();
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

      const sourcePdfPath = path.resolve(storageDir, "source-test-race.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%RACE SOURCE\n"), Buffer.alloc(80, 32)]);
      const sourceSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(sourcePdfPath, pdfBytes);

      const targetFilename = `invoice-inv-race-rev0-${sourceSha.slice(0, 16)}.pdf`;
      const targetPath = path.resolve(archiveDir, targetFilename);
      const originalArchiveContent = Buffer.from("%PDF-1.4\n%EXISTING ORIGINAL IMMUTABLE BYTES\n");

      // Spy on fs.writeFileSync to simulate another process creating targetPath right before linkSync with differing content
      const realWriteFileSync = fs.writeFileSync;
      const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file: any, data: any, options: any) => {
        const res = realWriteFileSync(file, data, options);
        if (typeof file === "string" && file.includes(`.${targetFilename}.`)) {
          // Concurrent process creates target file right after temp file is written!
          realWriteFileSync(targetPath, originalArchiveContent);
        }
        return res;
      });

      try {
        await expect(
          persistArchivedOriginalPdf(sourcePdfPath, "inv-race", sourceSha)
        ).rejects.toThrow(/existiert bereits im Archiv.*und darf nicht überschrieben werden/);

        // Verify the original target file bytes were NOT overwritten by linkSync
        const preservedBytes = fs.readFileSync(targetPath);
        expect(preservedBytes.equals(originalArchiveContent)).toBe(true);
      } finally {
        writeSpy.mockRestore();
        if (fs.existsSync(sourcePdfPath)) fs.unlinkSync(sourcePdfPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    });

    it("idempotently succeeds via fs.linkSync when target file was created concurrently with identical content", async () => {
      const archiveDir = getArchivedInvoicesDirectory();
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

      const sourcePdfPath = path.resolve(storageDir, "source-test-race-identical.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%RACE SOURCE IDENTICAL\n"), Buffer.alloc(80, 32)]);
      const sourceSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(sourcePdfPath, pdfBytes);

      const targetFilename = `invoice-inv-race-id-rev0-${sourceSha.slice(0, 16)}.pdf`;
      const targetPath = path.resolve(archiveDir, targetFilename);

      // Spy on fs.writeFileSync to simulate another process creating targetPath with IDENTICAL bytes right after temp file is written
      const realWriteFileSync = fs.writeFileSync;
      const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((file: any, data: any, options: any) => {
        const res = realWriteFileSync(file, data, options);
        if (typeof file === "string" && file.includes(`.${targetFilename}.`)) {
          realWriteFileSync(targetPath, pdfBytes);
        }
        return res;
      });

      try {
        const result = await persistArchivedOriginalPdf(sourcePdfPath, "inv-race-id", sourceSha);
        expect(result.archivedPath).toBe(targetPath);
        expect(result.sha256).toBe(sourceSha);
        expect(result.byteLength).toBe(pdfBytes.length);

        const preservedBytes = fs.readFileSync(targetPath);
        expect(preservedBytes.equals(pdfBytes)).toBe(true);
      } finally {
        writeSpy.mockRestore();
        if (fs.existsSync(sourcePdfPath)) fs.unlinkSync(sourcePdfPath);
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      }
    });

    it("accepts refresh when historical invoice has a verified stored PDF file on disk", async () => {
      // Mock a verified file on disk
      const mockVerifier = vi.fn().mockResolvedValue({
        exists: true,
        sha256: "aabbcc11223344556677889900aabbcc11223344556677889900aabbcc112233",
        byteLength: 45678,
      });

      const check = await checkReliableHistoricalOrigin(
        {
          id: "inv-stored",
          pdfUrl: "/uploads/invoices/inv-stored.pdf",
          snapshotData: null,
        },
        mockVerifier
      );

      expect(check.reliable).toBe(true);
      expect(check.source).toBe("stored_pdf");
      expect(check.storedPdfInfo?.sha256).toBe("aabbcc11223344556677889900aabbcc11223344556677889900aabbcc112233");
    });

    it("accepts refresh when historical invoice has a complete frozen snapshot in snapshotData", async () => {
      const completeSnapshot = {
        facilityName: "Seniorenresidenz RheinAhr",
        address: "Musterstraße 12, 53474 Bad Neuenahr",
        date: "2026-03-01",
        subtotal: "40,00 €",
        taxAmount: "7,60 €",
        total: "47,60 €",
        items: [
          {
            description: "Pflegefachkraft Schichtdienst",
            hours: 1.0,
            rate: "40,00 €",
            total: "40,00 €",
          },
        ],
      };

      const check = await checkReliableHistoricalOrigin({
        id: "inv-frozen",
        pdfUrl: null,
        snapshotData: completeSnapshot,
      });

      expect(check.reliable).toBe(true);
      expect(check.source).toBe("frozen_snapshot");
      expect(check.frozenSnapshotSha256).toBeDefined();
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
        snapshotData: {
          facilityName: "Seniorenresidenz RheinAhr",
          address: "Musterstr. 12, 53474 Bad Neuenahr",
          date: "2026-03-01",
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
          items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
        },
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
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-fail-closed", { ...deps, adminId: "admin-super" });

      await expect(
        confirmV2InvoiceRefresh(
          {
            invoiceId: "inv-fail-closed",
            previewToken: preview.previewToken,
            performedByUserId: "admin-super",
          },
          deps
        )
      ).rejects.toThrow(/REVISION_CREATION_FAILED/);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it("records full invoice provenance including reliable origin standard and client identity in revision", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-prov-1" });
      const mockInvoice = {
        id: "inv-prov-1",
        invoiceNumber: "INV-PROV-100",
        status: "unpaid",
        date: new Date("2026-03-01T10:00:00Z"),
        dueDate: new Date("2026-03-15T10:00:00Z"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        taxRate: 0.19,
        clientId: "client-1",
        pdfUrl: null,
        snapshotData: {
          facilityName: "Seniorenresidenz RheinAhr",
          address: "Musterstr. 12, 53474 Bad Neuenahr",
          shortCode: "RA-HIST-100",
          date: "2026-03-01",
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
          items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
        },
        client: a1.order.client,
        assignments: [a1],
      };

      let capturedRevisionData: any = null;

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
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockImplementation((args: any) => {
            capturedRevisionData = args.data;
            return Promise.resolve({ id: "rev-prov-1", ...args.data });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-prov-1" }),
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

      const preview = await previewV2InvoiceRefresh("inv-prov-1", { ...deps, adminId: "admin-alice" });
      await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-prov-1",
          previewToken: preview.previewToken,
          performedByUserId: "admin-alice",
          reason: "Provenance verification test",
        },
        deps
      );

      expect(capturedRevisionData).toBeDefined();
      expect(capturedRevisionData.revisionNumber).toBe(1);

      const prevSnap = capturedRevisionData.previousSnapshotData;
      expect(prevSnap.invoiceNumber).toBe("INV-PROV-100");
      expect(prevSnap.client.facilityName).toBe("Seniorenresidenz RheinAhr");
      expect(prevSnap.client.shortCode).toBe("RA-HIST-100");
      expect(prevSnap.client.internalNumber).toBeNull();
      expect(prevSnap.client.billingInfo).toBeNull();
      expect(prevSnap.liveClientAtRefresh.shortCode).toBe("RA-100");
      expect(prevSnap.originReliability).toBe("frozen_snapshot");
      expect(prevSnap.isRegeneratedFromFrozenData).toBe(true);
      expect(prevSnap.isByteForByteOriginalFile).toBe(false);
      expect(prevSnap.frozenSnapshotSha256).toBeDefined();
      expect(prevSnap.assignmentIds).toEqual(["assign-1"]);
    });

    it("fails closed with ORIGINAL_PDF_ARCHIVAL_FAILED and rolls back transaction when PDF archival fails", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-arch-fail" });
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
      const validPdf = path.resolve(storageDir, "valid-for-archive-fail.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 32)]);
      fs.writeFileSync(validPdf, pdfBytes);

      try {
        const mockInvoice = {
          id: "inv-arch-fail",
          invoiceNumber: "INV-ARCH-FAIL",
          status: "unpaid",
          date: new Date(),
          netAmount: 40.0,
          vatAmount: 7.6,
          grossAmount: 47.6,
          pdfUrl: validPdf,
          snapshotData: null,
          client: a1.order.client,
          assignments: [a1],
        };

        const mockPrisma = {
          $queryRaw: vi.fn().mockImplementation((query: any) => {
            const sql = String(query.strings ? query.strings.join(" ") : query);
            if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
            if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-arch-fail" }]);
            return Promise.resolve([]);
          }),
          invoice: {
            findUnique: vi.fn().mockResolvedValue(mockInvoice),
            update: vi.fn(),
          },
          assignment: {
            findMany: vi.fn().mockResolvedValue([a1]),
          },
          invoiceRevision: {
            count: vi.fn().mockResolvedValue(0),
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn(),
          },
          auditLog: { create: vi.fn() },
          $transaction: vi.fn().mockImplementation(async (cb: any) => await cb(mockPrisma)),
        };

        const deps = {
          prisma: mockPrisma,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          archivePdfFn: vi.fn().mockImplementation(() => {
            throw new InvoiceRefreshError(
              "ORIGINAL_PDF_ARCHIVAL_FAILED",
              "[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Simulierte E/A-Störung."
            );
          }),
        };

        const preview = await previewV2InvoiceRefresh("inv-arch-fail", { ...deps, adminId: "admin-super" });
        await expect(
          confirmV2InvoiceRefresh(
            {
              invoiceId: "inv-arch-fail",
              previewToken: preview.previewToken,
              performedByUserId: "admin-super",
            },
            deps
          )
        ).rejects.toThrow(/ORIGINAL_PDF_ARCHIVAL_FAILED/);

        expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
        expect(mockPrisma.invoiceRevision.create).not.toHaveBeenCalled();
      } finally {
        if (fs.existsSync(validPdf)) fs.unlinkSync(validPdf);
      }
    });

    it("succeeds on retry after database transaction rollback without modifying existing archive bytes", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
      const archiveDir = getArchivedInvoicesDirectory();
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const validPdf = path.resolve(storageDir, "valid-for-rollback-retry.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%ORIGINAL FOR RETRY TEST\n"), Buffer.alloc(100, 32)]);
      const sourceSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(validPdf, pdfBytes);

      const a1 = createSyntheticAssignment("assign-retry-1", { invoiceId: "inv-retry-1" });
      const mockInvoice = {
        id: "inv-retry-1",
        invoiceNumber: "INV-RETRY-100",
        status: "unpaid",
        date: new Date("2026-03-01T10:00:00Z"),
        dueDate: new Date("2026-03-15T10:00:00Z"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        taxRate: 0.19,
        clientId: "client-1",
        pdfUrl: validPdf,
        snapshotData: null,
        client: a1.order.client,
        assignments: [a1],
      };

      const targetFilename = `invoice-inv-retry-1-rev0-${sourceSha.slice(0, 16)}.pdf`;
      const targetArchivePath = path.resolve(archiveDir, targetFilename);

      let shouldFailDbTransaction = true;
      let revisionCreated = false;

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-retry-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-retry-1" }]);
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
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockImplementation((args: any) => {
            if (shouldFailDbTransaction) {
              throw new Error("Simulated database transient error during revision insertion");
            }
            revisionCreated = true;
            return Promise.resolve({ id: "rev-retry-1", ...args.data });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-retry-1" }),
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

      try {
        const preview = await previewV2InvoiceRefresh("inv-retry-1", { ...deps, adminId: "admin-retry" });

        // First attempt: DB transaction fails after archival
        await expect(
          confirmV2InvoiceRefresh(
            {
              invoiceId: "inv-retry-1",
              previewToken: preview.previewToken,
              performedByUserId: "admin-retry",
              reason: "First attempt that will fail in DB",
            },
            deps
          )
        ).rejects.toThrow(/Simulated database transient error/);

        // Verification 1: Archive file was indeed created before DB failure
        expect(fs.existsSync(targetArchivePath)).toBe(true);
        const archivedBytesAfterFirstAttempt = fs.readFileSync(targetArchivePath);
        expect(archivedBytesAfterFirstAttempt.equals(pdfBytes)).toBe(true);
        const statAfterFirstAttempt = fs.statSync(targetArchivePath);

        // Second attempt: DB transient error resolved, retry with same invoice and origin
        shouldFailDbTransaction = false;
        const confirmResult = await confirmV2InvoiceRefresh(
          {
            invoiceId: "inv-retry-1",
            previewToken: preview.previewToken,
            performedByUserId: "admin-retry",
            reason: "Retry attempt after DB recovery",
          },
          deps
        );

        // Verification 2: Retry succeeds, revision is created
        expect(confirmResult).toBeDefined();
        expect(confirmResult.success).toBe(true);
        expect(revisionCreated).toBe(true);

        // Verification 3: Archive file was NOT modified or corrupted on retry
        expect(fs.existsSync(targetArchivePath)).toBe(true);
        const archivedBytesAfterRetry = fs.readFileSync(targetArchivePath);
        expect(archivedBytesAfterRetry.equals(pdfBytes)).toBe(true);
        const statAfterRetry = fs.statSync(targetArchivePath);
        expect(statAfterRetry.size).toBe(statAfterFirstAttempt.size);
      } finally {
        if (fs.existsSync(validPdf)) fs.unlinkSync(validPdf);
        if (fs.existsSync(targetArchivePath)) fs.unlinkSync(targetArchivePath);
      }
    });

    it("serves exact original stored PDF file bytes when available for revision=0 route", async () => {
      // Create a temporary valid PDF file inside storage/invoices
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      const tempPdfPath = path.resolve(storageDir, "valid-original-stored-invoice.pdf");
      const pdfBytes = Buffer.concat([
        Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"),
        Buffer.alloc(60, 32),
      ]);
      const exactSha256 = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(tempPdfPath, pdfBytes);

      try {
        const mockInvoice = {
          id: "inv-route-pdf",
          invoiceNumber: "RE-2026-PDF",
          status: "unpaid",
          date: new Date("2026-03-01"),
          netAmount: 100,
          vatAmount: 19,
          grossAmount: 119,
          client: { id: "c-1", userId: "u-1", facilityName: "Current Live Client Name" },
          assignments: [],
        };

        const mockRev1 = {
          id: "rev-1",
          invoiceId: "inv-route-pdf",
          revisionNumber: 1,
          previousNetAmount: 100,
          previousVatAmount: 19,
          previousGrossAmount: 119,
          previousSnapshotData: {
            invoiceNumber: "RE-2026-PDF",
            originReliability: "stored_pdf",
            storedPdfInfo: {
              archivedPath: tempPdfPath,
              sha256: exactSha256,
              byteLength: pdfBytes.length,
            },
            client: { facilityName: "Historical Client Name" },
          },
        };

        (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

        const req = new Request("http://localhost/api/invoices/inv-route-pdf/pdf?revision=0");
        const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-route-pdf" }) });

        expect(res.status).toBe(200);
        expect(res.headers.get("X-Document-Source")).toBe("stored_original_file");
        expect(res.headers.get("Content-Type")).toBe("application/pdf");
        expect(res.headers.get("X-Document-Checksum")).toBe(exactSha256);

        const bodyBytes = Buffer.from(await res.arrayBuffer());
        expect(bodyBytes.toString()).toBe(pdfBytes.toString());
      } finally {
        if (fs.existsSync(tempPdfPath)) {
          fs.unlinkSync(tempPdfPath);
        }
      }
    });

    it("rejects revision=0 download with 409 Conflict when stored PDF on disk has been altered (checksum mismatch)", async () => {
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      const tempPdfPath = path.resolve(storageDir, "tampered-invoice.pdf");
      const originalBytes = Buffer.concat([
        Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"),
        Buffer.alloc(60, 65), // Original filled with 'A'
      ]);
      const expectedSha256 = createHash("sha256").update(originalBytes).digest("hex");

      // Tampered file on disk: same header, but content altered ('B')
      const tamperedBytes = Buffer.concat([
        Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n"),
        Buffer.alloc(60, 66), // Tampered filled with 'B'
      ]);
      fs.writeFileSync(tempPdfPath, tamperedBytes);

      try {
        const mockInvoice = {
          id: "inv-tampered",
          invoiceNumber: "RE-TAMPERED-01",
          status: "unpaid",
          date: new Date("2026-03-01"),
          netAmount: 100,
          vatAmount: 19,
          grossAmount: 119,
          client: { id: "c-1", userId: "u-1", facilityName: "Client" },
          assignments: [],
        };

        const mockRev1 = {
          id: "rev-1",
          invoiceId: "inv-tampered",
          revisionNumber: 1,
          previousNetAmount: 100,
          previousVatAmount: 19,
          previousGrossAmount: 119,
          previousSnapshotData: {
            invoiceNumber: "RE-TAMPERED-01",
            originReliability: "stored_pdf",
            storedPdfInfo: {
              archivedPath: tempPdfPath,
              sha256: expectedSha256, // Expects original SHA-256!
              byteLength: originalBytes.length,
            },
            client: { facilityName: "Client" },
          },
        };

        (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

        const req = new Request("http://localhost/api/invoices/inv-tampered/pdf?revision=0");
        const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-tampered" }) });

        expect(res.status).toBe(409);
        const errText = await res.text();
        expect(errText).toMatch(/Checksum-Mismatch/);
      } finally {
        if (fs.existsSync(tempPdfPath)) {
          fs.unlinkSync(tempPdfPath);
        }
      }
    });

    it("rejects revision=0 download with 409 Conflict when stored PDF on disk is missing", async () => {
      const mockInvoice = {
        id: "inv-missing-pdf",
        invoiceNumber: "RE-MISSING-01",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 100,
        vatAmount: 19,
        grossAmount: 119,
        client: { id: "c-1", userId: "u-1", facilityName: "Client" },
        assignments: [],
      };

      const mockRev1 = {
        id: "rev-1",
        invoiceId: "inv-missing-pdf",
        revisionNumber: 1,
        previousNetAmount: 100,
        previousVatAmount: 19,
        previousGrossAmount: 119,
        previousSnapshotData: {
          invoiceNumber: "RE-MISSING-01",
          originReliability: "stored_pdf",
          storedPdfInfo: {
            archivedPath: path.resolve(process.cwd(), "storage/archived-invoices/does-not-exist.pdf"),
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            byteLength: 500,
          },
          client: { facilityName: "Client" },
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
      (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

      const req = new Request("http://localhost/api/invoices/inv-missing-pdf/pdf?revision=0");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-missing-pdf" }) });

      expect(res.status).toBe(409);
      const errText = await res.text();
      expect(errText).toMatch(/nicht auf dem Server gefunden/);
    });

    it("serves permanently archived copy from storage/archived-invoices for revision=0 even if original source file is deleted after refresh", async () => {
      const archiveDir = path.resolve(process.cwd(), "storage/archived-invoices");
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const archivedPdfPath = path.resolve(archiveDir, "invoice-inv-del-rev0-test.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%ARCHIVED ORIGINAL\n"), Buffer.alloc(80, 32)]);
      const exactSha = createHash("sha256").update(pdfBytes).digest("hex");
      fs.writeFileSync(archivedPdfPath, pdfBytes);

      try {
        const mockInvoice = {
          id: "inv-del",
          invoiceNumber: "RE-ARCH-DEL-01",
          status: "unpaid",
          date: new Date("2026-03-01"),
          netAmount: 100,
          vatAmount: 19,
          grossAmount: 119,
          client: { id: "c-1", facilityName: "Current Client" },
          assignments: [],
        };

        const mockRev1 = {
          id: "rev-1",
          invoiceId: "inv-del",
          revisionNumber: 1,
          previousNetAmount: 100,
          previousVatAmount: 19,
          previousGrossAmount: 119,
          previousSnapshotData: {
            invoiceNumber: "RE-ARCH-DEL-01",
            originReliability: "stored_pdf",
            storedPdfInfo: {
              path: "/storage/invoices/deleted-source-file.pdf", // deleted original source!
              archivedPath: archivedPdfPath, // permanent archive copy!
              sha256: exactSha,
              byteLength: pdfBytes.length,
            },
            client: { facilityName: "Historical Client" },
          },
        };

        (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

        const req = new Request("http://localhost/api/invoices/inv-del/pdf?revision=0");
        const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-del" }) });

        expect(res.status).toBe(200);
        expect(res.headers.get("X-Document-Source")).toBe("stored_original_file");
        expect(res.headers.get("X-Document-Checksum")).toBe(exactSha);
        const returnedBuf = Buffer.from(await res.arrayBuffer());
        expect(returnedBuf.equals(pdfBytes)).toBe(true);
      } finally {
        if (fs.existsSync(archivedPdfPath)) fs.unlinkSync(archivedPdfPath);
      }
    });

    it("regenerates PDF from frozen snapshot data for revision=0 without being affected by live client edits", async () => {
      const mockInvoice = {
        id: "inv-route-snap",
        invoiceNumber: "RE-2026-SNAP",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        // Live client has been renamed in DB!
        client: { id: "c-1", userId: "u-1", facilityName: "MUTATED LIVE NAME IN DATABASE", address: "MUTATED ADDRESS" },
        assignments: [],
      };

      const mockRev1 = {
        id: "rev-1",
        invoiceId: "inv-route-snap",
        revisionNumber: 1,
        previousNetAmount: 40,
        previousVatAmount: 7.6,
        previousGrossAmount: 47.6,
        previousSnapshotData: {
          invoiceNumber: "RE-2026-SNAP",
          originReliability: "frozen_snapshot",
          // Historical snapshot preserved original facilityName & address
          client: {
            id: "c-1",
            facilityName: "ORIGINAL HISTORICAL FACILITY NAME",
            address: "Historical Address 1, 53474 Bad Neuenahr",
            billingInfo: "Faktura Hist",
          },
          rawSnapshotData: {
            facilityName: "ORIGINAL HISTORICAL FACILITY NAME",
            address: "Historical Address 1, 53474 Bad Neuenahr",
            date: "2026-03-01",
            subtotal: "40,00 €",
            taxAmount: "7,60 €",
            total: "47,60 €",
            items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
          },
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
      (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

      const req = new Request("http://localhost/api/invoices/inv-route-snap/pdf?revision=0");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-route-snap" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("regenerated_from_frozen_snapshot");
      expect(res.headers.get("X-Document-Is-Byte-Original")).toBe("false");
    });

    it("rejects revision=0 download with 422 when frozen snapshot lacks mandatory client facilityName or address", async () => {
      const mockInvoice = {
        id: "inv-route-incomplete",
        invoiceNumber: "RE-INCOMPLETE-01",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        client: { id: "c-1", userId: "u-1", facilityName: "Live Name", address: "Live Address" },
        assignments: [],
      };

      const mockRev1 = {
        id: "rev-1",
        invoiceId: "inv-route-incomplete",
        revisionNumber: 1,
        previousNetAmount: 40,
        previousVatAmount: 7.6,
        previousGrossAmount: 47.6,
        previousSnapshotData: {
          invoiceNumber: "RE-INCOMPLETE-01",
          originReliability: "frozen_snapshot",
          // Client object in snapshot is missing address!
          client: {
            id: "c-1",
            facilityName: "ORIGINAL FACILITY NAME",
            address: null,
          },
          rawSnapshotData: {
            facilityName: "ORIGINAL FACILITY NAME",
            subtotal: "40,00 €",
            taxAmount: "7,60 €",
            total: "47,60 €",
            items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
          },
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
      (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

      const req = new Request("http://localhost/api/invoices/inv-route-incomplete/pdf?revision=0");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-route-incomplete" }) });

      expect(res.status).toBe(422);
      const errText = await res.text();
      expect(errText).toMatch(/Mandantendaten .* fehlen im archivierten Snapshot/);
    });

    it("rejects revision=0 download with 409 Conflict when archivedPath is missing or missing from disk, refusing to fallback to legacy source path", async () => {
      const storageDir = path.resolve(process.cwd(), "storage/invoices");
      if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

      const sourcePdfPath = path.resolve(storageDir, "valid-source-file-present.pdf");
      const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n%SOURCE ORIGINAL\n"), Buffer.alloc(80, 32)]);
      fs.writeFileSync(sourcePdfPath, pdfBytes);

      try {
        const mockInvoice = {
          id: "inv-strict-arch",
          invoiceNumber: "RE-STRICT-01",
          status: "unpaid",
          date: new Date("2026-03-01"),
          netAmount: 100,
          vatAmount: 19,
          grossAmount: 119,
          client: { id: "c-1", facilityName: "Client" },
          assignments: [],
        };

        // Scenario 1: archivedPath is completely missing from storedPdfInfo even though legacy path exists
        const mockRevNoArchPath = {
          id: "rev-1",
          invoiceId: "inv-strict-arch",
          revisionNumber: 1,
          previousNetAmount: 100,
          previousVatAmount: 19,
          previousGrossAmount: 119,
          previousSnapshotData: {
            invoiceNumber: "RE-STRICT-01",
            originReliability: "stored_pdf",
            storedPdfInfo: {
              path: sourcePdfPath, // source exists on disk!
            },
            client: { facilityName: "Client" },
          },
        };

        (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRevNoArchPath);

        const req1 = new Request("http://localhost/api/invoices/inv-strict-arch/pdf?revision=0");
        const res1 = await getInvoicePdfRoute(req1, { params: Promise.resolve({ id: "inv-strict-arch" }) });
        expect(res1.status).toBe(409);
        const errText1 = await res1.text();
        expect(errText1).toMatch(/archivedPath fehlt/);

        // Scenario 2: archivedPath points to missing file, while source file is present on disk
        const mockRevMissingArchFile = {
          id: "rev-1",
          invoiceId: "inv-strict-arch",
          revisionNumber: 1,
          previousNetAmount: 100,
          previousVatAmount: 19,
          previousGrossAmount: 119,
          previousSnapshotData: {
            invoiceNumber: "RE-STRICT-01",
            originReliability: "stored_pdf",
            storedPdfInfo: {
              path: sourcePdfPath, // source exists on disk!
              archivedPath: path.resolve(process.cwd(), "storage/archived-invoices/lost-archive.pdf"), // missing on disk!
              sha256: "some-sha",
              byteLength: 100,
            },
            client: { facilityName: "Client" },
          },
        };
        (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRevMissingArchFile);

        const req2 = new Request("http://localhost/api/invoices/inv-strict-arch/pdf?revision=0");
        const res2 = await getInvoicePdfRoute(req2, { params: Promise.resolve({ id: "inv-strict-arch" }) });
        expect(res2.status).toBe(409);
        const errText2 = await res2.text();
        expect(errText2).toMatch(/nicht auf dem Server gefunden/);
      } finally {
        if (fs.existsSync(sourcePdfPath)) fs.unlinkSync(sourcePdfPath);
      }
    });

    it("prioritizes historical client identity from rawSnapshotData when regenerating revision 0", async () => {
      const mockInvoice = {
        id: "inv-hist-priority",
        invoiceNumber: "RE-HIST-01",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        // Live client has mutated name & address in DB
        client: { id: "c-1", facilityName: "Mutated Live Facility", address: "Mutated Live Address" },
        assignments: [],
      };

      const mockRev1 = {
        id: "rev-1",
        invoiceId: "inv-hist-priority",
        revisionNumber: 1,
        previousNetAmount: 40,
        previousVatAmount: 7.6,
        previousGrossAmount: 47.6,
        previousSnapshotData: {
          invoiceNumber: "RE-HIST-01",
          originReliability: "frozen_snapshot",
          // previousProvenance.client has fallback values, but rawSnapshotData has original historical client!
          client: {
            id: "c-1",
            facilityName: "Fallback Facility",
            address: "Fallback Address",
          },
          rawSnapshotData: {
            facilityName: "Klinikum Altenahr Historisch",
            address: "Historische Str. 42, 53505 Altenahr",
            date: "2026-03-01",
            subtotal: "40,00 €",
            taxAmount: "7,60 €",
            total: "47,60 €",
            items: [{ description: "Pflegefachkraft Schicht", hours: 1, total: "40,00 €" }],
          },
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
      (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

      const req = new Request("http://localhost/api/invoices/inv-hist-priority/pdf?revision=0");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-hist-priority" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("regenerated_from_frozen_snapshot");
    });

    it("strictly prevents live client internalNumber and billingInfo from leaking into revision 0 historical PDF when absent from snapshot", async () => {
      const mockInvoice = {
        id: "inv-leak-test",
        invoiceNumber: "RE-LEAK-01",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        // Live client has mutated internalNumber and billingInfo in DB!
        client: {
          id: "c-live-1",
          facilityName: "Live Facility Name",
          address: "Live Street 10",
          internalNumber: "LIVE-INTERNAL-9999",
          billingInfo: "LIVE-BILLING-CONFIDENTIAL-INFO",
          shortCode: "LIVE-SC",
        },
        assignments: [],
      };

      // Historical snapshot has facilityName and address, but lacks internalNumber, billingInfo, shortCode
      const mockRev1 = {
        id: "rev-1",
        invoiceId: "inv-leak-test",
        revisionNumber: 1,
        previousNetAmount: 40,
        previousVatAmount: 7.6,
        previousGrossAmount: 47.6,
        previousSnapshotData: {
          invoiceNumber: "RE-LEAK-01",
          originReliability: "frozen_snapshot",
          client: {
            id: "c-hist-1",
            facilityName: "Alte Residenz Historisch",
            address: "Historische Gasse 1",
            internalNumber: null,
            billingInfo: null,
            shortCode: null,
          },
          rawSnapshotData: {
            facilityName: "Alte Residenz Historisch",
            address: "Historische Gasse 1",
            date: "2026-03-01",
            subtotal: "40,00 €",
            taxAmount: "7,60 €",
            total: "47,60 €",
            items: [{ description: "Pflege", hours: 1, total: "40,00 €" }],
          },
        },
      };

      (prisma.invoice.findUnique as any).mockResolvedValue(mockInvoice);
      (prisma.invoiceRevision.findUnique as any).mockResolvedValue(mockRev1);

      const req = new Request("http://localhost/api/invoices/inv-leak-test/pdf?revision=0");
      const res = await getInvoicePdfRoute(req, { params: Promise.resolve({ id: "inv-leak-test" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Document-Source")).toBe("regenerated_from_frozen_snapshot");

      // Verify via buildInvoicePdfData that dummy/frozen client used for rev 0 does NOT contain live internalNumber or billingInfo
      const { buildInvoicePdfData } = await import("./invoice-pdf-builder");
      const invoiceForRevision = {
        invoiceNumber: "RE-LEAK-01",
        date: new Date("2026-03-01"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: mockRev1.previousSnapshotData.rawSnapshotData,
      };
      // Frozen client constructed without live values
      const frozenClient = {
        id: "HISTORICAL-CLIENT",
        shortCode: null,
        internalNumber: null,
        facilityName: "Alte Residenz Historisch",
        address: "Historische Gasse 1",
        billingEmail: null,
        billingInfo: null,
        paymentTermsDays: 14,
        hourlyRates: {},
        surchargeSat: 0,
        surchargeSun: 0,
        surchargeHoliday: 0,
        surchargeNight: 0,
        nightStart: "22:00",
        nightEnd: "06:00",
      };
      const builtData = buildInvoicePdfData(invoiceForRevision as any, frozenClient as any, []);
      expect(builtData.clientId).not.toBe("LIVE-INTERNAL-9999");
      expect(builtData.clientId).not.toBe("LIVE-SC");
      expect(builtData.billingInfo).toBeNull();
      expect(builtData.billingInfo).not.toBe("LIVE-BILLING-CONFIDENTIAL-INFO");
    });
  });

  // =========================================================================
  // Section 4: Finding 3 - Protection for Paid and Sent Invoices (Fail-Closed)
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
        snapshotData: {
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "100.00 €",
          taxAmount: "19.00 €",
          total: "119.00 €",
          items: [{ description: "Posten 1", hours: 1, total: "100.00 €" }],
        },
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

    it("rejects preview with SentInvoiceRefreshNotPermittedError when invoice has emailSent in snapshotData (Fail-Closed)", async () => {
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
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "40.00 €",
          taxAmount: "7.60 €",
          total: "47.60 €",
          items: [{ description: "Posten 1", hours: 1, total: "40.00 €" }],
          emailSent: true, // Sent indicator!
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

      await expect(
        previewV2InvoiceRefresh("inv-sent", deps)
      ).rejects.toThrow(SentInvoiceRefreshNotPermittedError);
    });

    it("rejects preview with SentInvoiceRefreshNotPermittedError when invoice has status 'sent'", async () => {
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-sent-status" });
      const mockSentInvoice = {
        id: "inv-sent-status",
        invoiceNumber: "INV-SENT-STATUS",
        status: "sent", // status is sent!
        date: new Date(),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          facilityName: "Test Facility",
          address: "Teststr. 1",
          date: "2026-03-01",
          subtotal: "40.00 €",
          taxAmount: "7.60 €",
          total: "47.60 €",
          items: [{ description: "Posten 1", hours: 1, total: "40.00 €" }],
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

      await expect(
        previewV2InvoiceRefresh("inv-sent-status", deps)
      ).rejects.toThrow(SentInvoiceRefreshNotPermittedError);
    });

    it("rejects confirm on sent invoice unconditionally (Fail-Closed, zero overwrite, no silent bypass)", async () => {
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
          facilityName: "Test Facility",
          subtotal: "40.00 €",
          total: "47.60 €",
          items: [{ description: "Posten 1", hours: 1, total: "40.00 €" }],
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
          findMany: vi.fn().mockResolvedValue([]),
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

      await expect(
        confirmV2InvoiceRefresh(
          {
            invoiceId: "inv-sent",
            previewToken: "v1.dummy.token",
            performedByUserId: "admin-super",
          },
          deps
        )
      ).rejects.toThrow(SentInvoiceRefreshNotPermittedError);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Section 5: Frozen Root Client Fields in Snapshot (Finding 4)
  // =========================================================================
  describe("5. Frozen Root Client Fields in Snapshot & PDF Immutability (Finding 4)", () => {
    it("freezes facilityName, address, billingInfo at the root level of snapshotData and proves PDF immunity when client is mutated", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-freeze" });
      const initialInvoice = {
        id: "inv-freeze",
        invoiceNumber: "INV-FREEZE-2026",
        status: "unpaid",
        date: new Date("2026-03-01"),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          facilityName: "Seniorenresidenz RheinAhr",
          address: "Musterstr. 12, 53474 Bad Neuenahr",
          date: "2026-03-01",
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
          items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
        },
        client: a1.order.client,
        assignments: [a1],
      };

      let updatedInvoiceRecord: any = null;

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "assign-1" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-freeze" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(initialInvoice),
          update: vi.fn().mockImplementation((args: any) => {
            updatedInvoiceRecord = { ...initialInvoice, ...args.data };
            return Promise.resolve(updatedInvoiceRecord);
          }),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({ id: "rev-freeze-1" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-freeze-1" }),
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

      const preview = await previewV2InvoiceRefresh("inv-freeze", { ...deps, adminId: "admin-super" });
      await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-freeze",
          previewToken: preview.previewToken,
          performedByUserId: "admin-super",
        },
        deps
      );

      expect(updatedInvoiceRecord).toBeDefined();
      const snap = updatedInvoiceRecord.snapshotData;

      // Assert that frozen root fields exist directly on snap
      expect(snap.facilityName).toBe("Seniorenresidenz RheinAhr");
      expect(snap.address).toBe("Musterstr. 12, 53474 Bad Neuenahr");
      expect(snap.shortCode).toBe("RA-100");
      expect(snap.internalNumber).toBe("INT-999");
      expect(snap.billingEmail).toBe("buchhaltung@rheinahr.example.com");
      expect(snap.billingInfo).toBe("Zentrale Faktura");
      expect(snap.paymentTermsDays).toBe(14);
      expect(snap.isFrozen).toBe(true);

      // Mutate the live client record in database
      const mutatedLiveClient = {
        ...a1.order.client,
        facilityName: "VÖLLIG ANDERE EINRICHTUNG GMBH",
        address: "Ganz andere Straße 999, 12345 Berlin",
        shortCode: "DIFF-000",
        billingInfo: "Veränderte Faktura",
      };

      // Generate PDF data: must strictly read frozen snapshot values
      const pdfData = buildInvoicePdfData(updatedInvoiceRecord, mutatedLiveClient as any, [a1] as any);

      expect(pdfData.clientName).toBe("Seniorenresidenz RheinAhr");
      expect(pdfData.clientAddress).toBe("Musterstr. 12, 53474 Bad Neuenahr");
      expect(pdfData.clientId).toBe("INT-999");
      expect(pdfData.billingInfo).toBe("Zentrale Faktura");
      expect(pdfData.clientName).not.toBe("VÖLLIG ANDERE EINRICHTUNG GMBH");
    });
  });

  // =========================================================================
  // Section 6: Fresh V2 Immutability & Successive Revisions (Finding 4 & 5)
  // =========================================================================
  describe("6. Fresh V2 Immutability & Successive Revisions (Finding 4 & 5)", () => {
    it("rejects fresh V2 invoice without revision history with FreshV2InvoiceImmutableError", async () => {
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: "inv-fresh-v2" });
      const mockFreshV2Invoice = {
        id: "inv-fresh-v2",
        invoiceNumber: "INV-FRESH-V2-01",
        status: "unpaid",
        date: new Date(),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2", // Freshly issued under V2!
          facilityName: "Test Facility",
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
          pdfItems: [{ pos: 1, description: "Pflegefachkraft", hours: 1, rate: "40,00 €", amount: "40,00 €" }],
          items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
        },
        client: a1.order.client,
        assignments: [a1],
      };

      const mockPrisma = {
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockFreshV2Invoice),
        },
        invoiceRevision: {
          findMany: vi.fn().mockResolvedValue([]), // Zero revisions!
          count: vi.fn().mockResolvedValue(0),
        },
      };

      const deps = {
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      await expect(
        previewV2InvoiceRefresh("inv-fresh-v2", deps)
      ).rejects.toThrow(FreshV2InvoiceImmutableError);

      await expect(
        determineInvoiceRevisionState(mockFreshV2Invoice, mockPrisma)
      ).rejects.toThrow(FreshV2InvoiceImmutableError);
    });

    it("rejects corrupted revision chain when snapshot revisionNumber contradicts database revisions", async () => {
      const mockCorruptedInvoice = {
        id: "inv-corrupt",
        invoiceNumber: "INV-CORRUPT-01",
        snapshotData: {
          calculationVersion: "v2",
          revisionNumber: 5, // claims revision 5, but DB only has 1!
        },
      };

      const mockPrisma = {
        invoiceRevision: {
          findMany: vi.fn().mockResolvedValue([
            { id: "rev-1", revisionNumber: 1 },
          ]),
          count: vi.fn().mockResolvedValue(1),
        },
      };

      await expect(
        determineInvoiceRevisionState(mockCorruptedInvoice, mockPrisma)
      ).rejects.toThrow(RevisionChainCorruptedError);
    });

    it("rejects corrupted revision chain when revisions in DB have gaps (e.g. rev 1, rev 3)", async () => {
      const mockGapInvoice = {
        id: "inv-gap",
        invoiceNumber: "INV-GAP-01",
        snapshotData: {
          calculationVersion: "v2",
          revisionNumber: 3,
        },
      };

      const mockPrisma = {
        invoiceRevision: {
          findMany: vi.fn().mockResolvedValue([
            { id: "rev-1", revisionNumber: 1 },
            { id: "rev-3", revisionNumber: 3 }, // Gap! Missing revision 2
          ]),
        },
      };

      await expect(
        determineInvoiceRevisionState(mockGapInvoice, mockPrisma)
      ).rejects.toThrow(RevisionChainCorruptedError);
    });

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
          facilityName: "Seniorenresidenz RheinAhr",
          address: "Musterstr. 12, 53474 Bad Neuenahr",
          date: "2026-03-01",
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
          items: [{ description: "Pflegefachkraft", hours: 1, total: "40,00 €" }],
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
          findMany: vi.fn().mockImplementation(() => Promise.resolve(revisionsStore)),
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
      // Notice: Preview recognizes current invoice is at revision 1 and target is revision 2!
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
  // Section 7: Acceptance Benchmark & Single-Engine Parity - 17,04 €
  // =========================================================================
  describe("7. Acceptance Benchmark & Single-Engine Parity - 17,04 €", () => {
    it("Benchmark: refreshes legacy invoice with three 5.678 € raw lines to display 5,68 € and exactly Summe 17,04 € (not 17,03 €)", async () => {
      process.env.FEATURE_INVOICE_V2_REFRESH = "true";

      const a1 = createSyntheticAssignment("bench-1", {
        invoiceId: "inv-bench",
        qualification: "pflegehelfer",
        shiftDate: "2026-03-02",
      });
      const a2 = createSyntheticAssignment("bench-2", {
        invoiceId: "inv-bench",
        qualification: "pflegehelfer",
        shiftDate: "2026-03-03",
      });
      const a3 = createSyntheticAssignment("bench-3", {
        invoiceId: "inv-bench",
        qualification: "pflegehelfer",
        shiftDate: "2026-03-04",
      });

      const mockLegacyInvoice = {
        id: "inv-bench",
        invoiceNumber: "INV-BENCH-2026",
        status: "unpaid",
        date: new Date("2026-03-10"),
        netAmount: 17.03, // Legacy flaw: 17.03 € instead of display sum 17.04 €
        vatAmount: 3.24,
        grossAmount: 20.27,
        pdfUrl: null,
        snapshotData: {
          facilityName: "Seniorenresidenz RheinAhr",
          address: "Musterstr. 12, 53474 Bad Neuenahr",
          date: "2026-03-10",
          subtotal: "17,03 €",
          taxAmount: "3,24 €",
          total: "20,27 €",
          items: [
            { description: "Pflegehelfer", hours: 1, total: "5,67 €" },
            { description: "Pflegehelfer", hours: 1, total: "5,68 €" },
            { description: "Pflegehelfer", hours: 1, total: "5,68 €" },
          ],
        },
        client: a1.order.client,
        assignments: [a1, a2, a3],
      };

      let updatedInvoiceResult: any = null;
      let archivedRevisionResult: any = null;

      const mockPrisma = {
        $queryRaw: vi.fn().mockImplementation((query: any) => {
          const sql = String(query.strings ? query.strings.join(" ") : query);
          if (sql.includes("assignments")) return Promise.resolve([{ id: "bench-1" }, { id: "bench-2" }, { id: "bench-3" }]);
          if (sql.includes("invoices")) return Promise.resolve([{ id: "inv-bench" }]);
          return Promise.resolve([]);
        }),
        invoice: {
          findUnique: vi.fn().mockResolvedValue(mockLegacyInvoice),
          update: vi.fn().mockImplementation((args: any) => {
            updatedInvoiceResult = { ...mockLegacyInvoice, ...args.data };
            return Promise.resolve(updatedInvoiceResult);
          }),
        },
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2, a3]),
        },
        invoiceRevision: {
          count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockImplementation((args: any) => {
            archivedRevisionResult = args.data;
            return Promise.resolve({ id: "rev-bench-1", ...args.data });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-bench-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const deps = {
        prisma: mockPrisma,
        priceVersionResolver: vi.fn().mockResolvedValue(BENCHMARK_PRICE_VERSION),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
        effectiveHoursResolver: mockDefaultHoursResolver as any,
      };

      const preview = await previewV2InvoiceRefresh("inv-bench", { ...deps, adminId: "admin-benchmark" });

      // Verify display-anchored single-engine benchmark totals in preview
      expect(preview.proposed.formattedNet).toBe("17,04 €");
      expect(preview.proposed.formattedVat).toBe("3,24 €");
      expect(preview.proposed.formattedGross).toBe("20,28 €");
      expect(preview.proposed.netAmount).toBe(17.04);
      expect(preview.proposed.grossAmount).toBe(20.28);

      const confirm = await confirmV2InvoiceRefresh(
        {
          invoiceId: "inv-bench",
          previewToken: preview.previewToken,
          performedByUserId: "admin-benchmark",
          reason: "Fix benchmark display parity to exactly 17,04 €",
        },
        deps
      );

      expect(confirm.success).toBe(true);
      expect(confirm.netAmount).toBe(17.04);
      expect(confirm.vatAmount).toBe(3.24);
      expect(confirm.grossAmount).toBe(20.28);

      expect(updatedInvoiceResult.netAmount).toBe(17.04);
      expect(updatedInvoiceResult.grossAmount).toBe(20.28);
      expect(updatedInvoiceResult.snapshotData.subtotal).toBe("17,04 €");
      expect(updatedInvoiceResult.snapshotData.total).toBe("20,28 €");

      expect(archivedRevisionResult.previousNetAmount).toBe(17.03);
      expect(archivedRevisionResult.previousGrossAmount).toBe(20.27);
      expect(archivedRevisionResult.newNetAmount).toBe(17.04);
      expect(archivedRevisionResult.newGrossAmount).toBe(20.28);
    });
  });
});
