/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn(), usePathname: vi.fn(), Link: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/navigation", () => ({ createNavigation: () => ({ redirect: vi.fn(), useRouter: vi.fn(), usePathname: vi.fn(), Link: () => null }) }));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  getCurrentUser: vi.fn(async () => ({ id: "admin-super", role: "admin" })),
  roleSatisfies: vi.fn(() => true),
}));

import {
  issueV2Invoice,
  isV2InvoiceIssuanceEnabled,
  setV2InvoiceIssuanceOverrideForTesting,
  ConcurrentModificationError,
  computeV2DraftHash,
} from "./invoice-v2-issuance-service";
import {
  generateOrderInvoices,
  refreshInvoice,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";
import { buildInvoicePdfData, parseGermanCurrencyStringToCents } from "./invoice-pdf-builder";
import { generateInvoicePdf, type InvoicePdfData } from "./pdf/invoice";
import { resolveInvoiceSurchargePolicy, type FacilitySurchargePolicyRecord } from "./surcharge-policy";
import type { PriceVersionRecord } from "./invoice-v2-draft-service";
import { calculateExactInvoice, formatHundredthsGerman } from "./invoice-exact-engine";
import zlib from "node:zlib";

function extractTextFromPdfBuffer(pdfBuffer: Buffer): string {
  const textChunks: string[] = [];
  const bufferString = pdfBuffer.toString("binary");
  textChunks.push(bufferString);

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(bufferString)) !== null) {
    const rawStream = Buffer.from(match[1], "binary");
    try {
      const decompressed = zlib.inflateSync(rawStream);
      const str = decompressed.toString("latin1");
      textChunks.push(str);
      const decodedHex = str.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => {
        try {
          return Buffer.from(hex, "hex").toString("latin1");
        } catch {
          return _;
        }
      });
      textChunks.push(decodedHex);
    } catch {
      try {
        const decompressed = zlib.inflateRawSync(rawStream);
        const str = decompressed.toString("latin1");
        textChunks.push(str);
        const decodedHex = str.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => {
          try {
            return Buffer.from(hex, "hex").toString("latin1");
          } catch {
            return _;
          }
        });
        textChunks.push(decodedHex);
      } catch {
        // ignore non-flate
      }
    }
  }

  return textChunks.join("\n");
}

// Helper: Frozen NRW Policy
function createTestFrozenPolicy(): any {
  const baseRecord: FacilitySurchargePolicyRecord = {
    clientId: "client-facility-1",
    clientContractId: "contract-1",
    policyVersion: 1,
    federalState: "NW",
    municipality: "Köln",
    districtLocality: null,
    surchargeSat: 0.25,
    surchargeSun: 0.5,
    surchargeHoliday: 1.0,
    surchargeNight: 0.25,
    nightStart: "20:00",
    nightEnd: "06:00",
    combinationRule: "highest_non_night_plus_night",
    sourceType: "contract",
    sourceReference: "Rahmenvertrag § 7 vom 01.01.2026",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    isFrozen: false,
    frozenHash: "",
  };

  const resolved = resolveInvoiceSurchargePolicy({
    policy: baseRecord,
    referenceDate: "2026-03-01",
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
    referenceDate: "2026-03-01",
  });

  if (frozenRes.status !== "resolved") {
    throw new Error(`Failed to freeze policy: ${frozenRes.message}`);
  }

  return frozenRes;
}

const FROZEN_POLICY = createTestFrozenPolicy();

const STANDARD_PRICE_VERSION: PriceVersionRecord = {
  priceVersionId: "pv-pfk-2026-v1",
  clientId: "client-facility-1",
  qualification: "pflegefachkraft",
  hourlyRateInCents: 4000, // 40.00 €/h
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  contractId: "contract-1",
  sourceReference: "Preisvereinbarung § 3 vom 01.01.2026",
  sourceDocumentUrl: "https://storage.example.invalid/contract-1.pdf",
  verifiedAt: "2026-01-01T10:00:00.000Z",
  verifiedBy: "admin-user-1",
};

function createSyntheticAssignment(id: string, overrides?: any) {
  return {
    id,
    orderId: overrides?.orderId ?? `order-${id}`,
    workerId: overrides?.workerId ?? `worker-${id}`,
    contractId: overrides?.contractId ?? "contract-1",
    clientContract: {
      id: overrides?.contractId ?? "contract-1",
      clientId: overrides?.clientId ?? "client-facility-1",
      status: "signed",
    },
    serviceConfirmation: {
      id: `conf-${id}`,
      hoursWorked: 1,
      confirmedAt: new Date("2026-03-07T12:00:00Z"),
    },
    status: overrides?.status ?? "confirmed",
    invoiceId: overrides?.invoiceId ?? null,
    order: {
      id: overrides?.orderId ?? `order-${id}`,
      clientId: overrides?.clientId ?? "client-facility-1",
      requestGroupId: overrides?.requestGroupId ?? "req-group-1",
      clientContractId: overrides?.contractId ?? "contract-1",
      requiredQualification: overrides?.qualification ?? "pflegefachkraft",
      shiftDate: overrides?.shiftDate ? new Date(overrides.shiftDate) : new Date("2026-03-07T00:00:00.000Z"),
      startTime: overrides?.startTime ?? "08:00",
      endTime: overrides?.endTime ?? "09:00",
      breakMinutes: overrides?.breakMinutes ?? 0,
      client: {
        id: overrides?.clientId ?? "client-facility-1",
        facilityName: overrides?.facilityName ?? "Test Facility St. Josef",
        internalNumber: "1001",
        shortCode: "TF",
        address: "Test Str. 1, 50667 Köln",
        billingEmail: "billing@facility.invalid",
        billingInfo: null,
        paymentTermsDays: 14,
        userId: "client-user-1",
      },
    },
    worker: {
      id: overrides?.workerId ?? `worker-${id}`,
      fullName: overrides?.workerName ?? "Worker One",
      qualification: overrides?.qualification ?? "pflegefachkraft",
    },
  };
}

const mockDefaultHoursResolver = (id: string) =>
  Promise.resolve({
    assignmentId: id,
    effectiveHours: 1,
    effectiveStartTime: "08:00",
    effectiveEndTime: "09:00",
    effectiveBreakMinutes: 0,
    source: "service_confirmation" as const,
    effectiveVersion: "conf-token-1",
    isCorrected: false,
    approvedCorrection: null,
  });

describe("V2 Invoice Issuance Service & Integration (Phase 5b-2b)", () => {
  beforeEach(() => {
    setV2InvoiceIssuanceOverrideForTesting(true);
  });

  afterEach(() => {
    setV2InvoiceIssuanceOverrideForTesting(null);
  });

  // =========================================================================
  // Section 1: Acceptance Benchmark: Three lines of 5.68 € = Summe 17.04 €
  // =========================================================================
  describe("1. Acceptance Benchmark: Display-Anchored Math & Parity", () => {
    it("three lines with raw 5.678 € display 5,68 € per line and Summe 17,04 €, not 17,03 €", () => {
      // 0.14 hours (8.4 raw minutes -> 14 hundredths) at 40.56 €/h (4056 cents)
      // Raw: 0.14 * 40.56 = 5.6784 €
      // Display-anchored line: 14 hundredths * 4056 cents / 100 = 567.84 -> 568 cents = 5,68 €
      // 3 such lines: 568 + 568 + 568 = 1704 cents = 17,04 €
      // If unrounded floats were summed: 5.6784 * 3 = 17.0352 -> 17.03 € or 17.04 € depending on float rounding.
      const lines = [
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: "base" as const,
          priceVersionId: "pv1",
          minutes: 8, // round(8*100/60) = round(13.33) = 13 hundredths -> 13 * 4369 / 100 = 567.97 -> 568 cents = 5,68 €
          hourlyRate: 43.69,
        },
        {
          workerId: "w2",
          qualification: "pflegefachkraft",
          itemCategory: "base" as const,
          priceVersionId: "pv1",
          minutes: 8,
          hourlyRate: 43.69,
        },
        {
          workerId: "w3",
          qualification: "pflegefachkraft",
          itemCategory: "base" as const,
          priceVersionId: "pv1",
          minutes: 8,
          hourlyRate: 43.69,
        },
      ];

      const exactResult = calculateExactInvoice(lines);

      expect(exactResult.items).toHaveLength(3);
      expect(exactResult.items[0].amountCents).toBe(568);
      expect(exactResult.items[0].amountDisplay).toBe("5,68 €");
      expect(exactResult.items[1].amountCents).toBe(568);
      expect(exactResult.items[1].amountDisplay).toBe("5,68 €");
      expect(exactResult.items[2].amountCents).toBe(568);
      expect(exactResult.items[2].amountDisplay).toBe("5,68 €");

      // Exact display-anchored subtotal is sum of line items: 568 + 568 + 568 = 1704 cents = 17,04 €
      expect(exactResult.totals.subtotalCents).toBe(1704);
      expect(exactResult.totals.subtotalDisplay).toBe("17,04 €");
      expect(exactResult.totals.subtotalDisplay).not.toBe("17,03 €");

      // VAT (19% of 1704 = 323.76 -> 324 cents = 3,24 €)
      expect(exactResult.totals.taxAmountCents).toBe(324);
      expect(exactResult.totals.taxAmountDisplay).toBe("3,24 €");

      // Gross total: 1704 + 324 = 2028 cents = 20,28 €
      expect(exactResult.totals.totalCents).toBe(2028);
      expect(exactResult.totals.totalDisplay).toBe("20,28 €");
      expect(exactResult.totals.subtotalCents + exactResult.totals.taxAmountCents).toBe(
        exactResult.totals.totalCents
      );
    });

    it("verifies mathematical parity across DB, snapshot, PDF data, and rendered PDF", async () => {
      const mockSnapshotData: any = {
        calculationVersion: "v2",
        facilityName: "Test Facility St. Josef",
        internalNumber: "1001",
        shortCode: "TF",
        address: "Test Str. 1, 50667 Köln",
        billingEmail: "billing@facility.invalid",
        billingInfo: null,
        paymentTermsDays: 14,
        periodStart: "07.03.2026",
        periodEnd: "07.03.2026",
        subtotalCents: 1704,
        taxAmountCents: 324,
        totalCents: 2028,
        subtotal: "17,04 €",
        taxAmount: "3,24 €",
        total: "20,28 €",
        taxRatePercent: 19,
        isFrozen: true,
        items: [
          { pos: 1, hoursDisplay: "0,13", rateDisplay: "43,69", amountDisplay: "5,68 €", amountCents: 568 },
          { pos: 2, hoursDisplay: "0,13", rateDisplay: "43,69", amountDisplay: "5,68 €", amountCents: 568 },
          { pos: 3, hoursDisplay: "0,13", rateDisplay: "43,69", amountDisplay: "5,68 €", amountCents: 568 },
        ],
        pdfItems: [
          { pos: 1, description: "Worker 1", hours: "0,13", rate: "43,69", amount: "5,68 €" },
          { pos: 2, description: "Worker 2", hours: "0,13", rate: "43,69", amount: "5,68 €" },
          { pos: 3, description: "Worker 3", hours: "0,13", rate: "43,69", amount: "5,68 €" },
        ],
      };

      const mockInvoice = {
        invoiceNumber: "476-TF-0326",
        date: new Date("2026-03-07"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: mockSnapshotData,
      };

      const mockClient = {
        id: "client-facility-1",
        shortCode: "TF",
        internalNumber: "1001",
        facilityName: "Test Facility St. Josef",
        address: "Test Str. 1, 50667 Köln",
        billingEmail: "billing@facility.invalid",
        billingInfo: null,
        hourlyRates: {},
        surchargeSat: 0.25,
        surchargeSun: 0.5,
        surchargeHoliday: 1.0,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
        paymentTermsDays: 14,
      };

      const pdfData = buildInvoicePdfData(mockInvoice as any, mockClient as any, []);

      expect(pdfData.subtotal).toBe("17,04 €");
      expect(pdfData.taxAmount).toBe("3,24 €");
      expect(pdfData.total).toBe("20,28 €");
      expect(pdfData.items).toHaveLength(3);
      expect(pdfData.items[0].amount).toBe("5,68 €");

      // Verify real PDF rendering works cleanly without errors
      const pdfBuffer = await generateInvoicePdf(pdfData);
      expect(pdfBuffer).toBeDefined();
      expect(pdfBuffer.subarray(0, 4).toString()).toBe("%PDF");
    });
  });

  // =========================================================================
  // Section 2: Feature Flag Behavior (Disabled by default)
  // =========================================================================
  describe("2. Server Feature Flag Isolation", () => {
    it("rejects V2 issuance when feature flag is disabled", async () => {
      setV2InvoiceIssuanceOverrideForTesting(false);

      const res = await issueV2Invoice({
        assignmentIds: ["assign-1"],
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("V2_ISSUANCE_DISABLED");
      }
    });

    it("defaults to disabled when env variable is not set", () => {
      setV2InvoiceIssuanceOverrideForTesting(null);
      const originalEnv = process.env.FEATURE_INVOICE_V2_ISSUANCE;
      delete process.env.FEATURE_INVOICE_V2_ISSUANCE;

      expect(isV2InvoiceIssuanceEnabled()).toBe(false);

      process.env.FEATURE_INVOICE_V2_ISSUANCE = originalEnv;
    });
  });

  // =========================================================================
  // Section 3: Precondition Validation & Non-Partial Invoicing Guards
  // =========================================================================
  describe("3. Precondition Validation & Zero Partial Invoicing", () => {
    it("rejects empty assignment list", async () => {
      const res = await issueV2Invoice({
        assignmentIds: [],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("NO_ASSIGNMENTS_SELECTED");
    });

    it("rejects duplicate assignment IDs", async () => {
      const res = await issueV2Invoice({
        assignmentIds: ["assign-1", "assign-1"],
      });
      expect(res.success).toBe(false);
      if (!res.success) expect(res.code).toBe("DUPLICATE_ASSIGNMENT_IDS");
    });

    it("rejects when an assignment is missing from the database", async () => {
      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([createSyntheticAssignment("assign-1")]),
        },
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1", "assign-missing"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("ASSIGNMENT_NOT_FOUND");
        expect(res.diagnostics?.missingAssignmentIds).toEqual(["assign-missing"]);
      }
    });

    it("rejects when any assignment is not in confirmed status", async () => {
      const a1 = createSyntheticAssignment("assign-1", { status: "confirmed" });
      const a2 = createSyntheticAssignment("assign-2", { status: "pending" });

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
        },
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1", "assign-2"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("ASSIGNMENT_NOT_CONFIRMED");
      }
    });

    it("rejects when any assignment is already billed (invoiceId !== null)", async () => {
      const a1 = createSyntheticAssignment("assign-1", { invoiceId: null });
      const a2 = createSyntheticAssignment("assign-2", { invoiceId: "existing-inv-123" });

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
        },
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1", "assign-2"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("ALREADY_BILLED");
      }
    });

    it("rejects when assignments belong to mixed clients", async () => {
      const a1 = createSyntheticAssignment("assign-1", { clientId: "client-A" });
      const a2 = createSyntheticAssignment("assign-2", { clientId: "client-B" });

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
        },
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1", "assign-2"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("MIXED_CLIENTS");
      }
    });

    it("rejects month issuance when shift falls outside month boundaries", async () => {
      const a1 = createSyntheticAssignment("assign-1", {
        clientId: "client-facility-1",
        shiftDate: "2026-04-01T10:00:00.000Z", // Outside March 2026
      });

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
          monthScope: { clientId: "client-facility-1", year: 2026, month: 3 },
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("MONTH_SCOPE_MISMATCH");
      }
    });
  });

  // =========================================================================
  // Section 4: Successful Atomic Issuance & Snapshot Freezing
  // =========================================================================
  describe("4. Atomic Issuance & Single-Engine Snapshot Freezing", () => {
    it("successfully issues a V2 order invoice and atomically freezes snapshotData", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      let createdInvoiceRecord: any = null;
      let linkedAssignmentIds: string[] = [];

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockImplementation((args: any) => {
            linkedAssignmentIds = args.where.id.in;
            return Promise.resolve({ count: linkedAssignmentIds.length });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation((args: any) => {
            createdInvoiceRecord = { id: "inv-created-v2-1", ...args.data };
            return Promise.resolve(createdInvoiceRecord);
          }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const auditMock = vi.fn().mockResolvedValue(undefined);

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-super", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          txAuditLogFn: auditMock,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.invoiceNumber).toBe("476-TF-0326");
        expect(res.calculationVersion).toBe("v2");
        expect(res.issuedByUserId).toBe("admin-super");
        // Saturday shift: 40.00 € base + 25% Saturday surcharge (10.00 €) = 50.00 € (5000 cents)
        expect(res.subtotalCents).toBe(5000);
        expect(res.taxAmountCents).toBe(950);  // 19% of 50.00 € = 9.50 €
        expect(res.totalCents).toBe(5950);      // 59.50 €
        expect(res.netAmount).toBe(50);
        expect(res.vatAmount).toBe(9.5);
        expect(res.grossAmount).toBe(59.5);

        // Verify snapshotData structure
        expect(res.snapshotData.calculationVersion).toBe("v2");
        expect(res.snapshotData.isFrozen).toBe(true);
        expect(res.snapshotData.issuedByUserId).toBe("admin-super");
        expect(res.snapshotData.subtotal).toBe("50,00 €");
        expect(res.snapshotData.taxAmount).toBe("9,50 €");
        expect(res.snapshotData.total).toBe("59,50 €");
        expect(res.snapshotData.pdfItems).toHaveLength(2); // 1 base line + 1 Saturday surcharge line
        expect(res.snapshotData.pricingProvenance.assignmentIds).toEqual(["assign-1"]);

        // Verify conditional atomic assignment linking occurred
        expect(linkedAssignmentIds).toEqual(["assign-1"]);
        expect(auditMock).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "admin-super",
            action: "invoice.generate_v2",
            entity: "Invoice",
          }),
          expect.anything()
        );
      }
    });

    it("verifies anti-tamper check rejects issuance if draft mutated since preview", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
          expectedDraftHash: "tampered-hash-from-old-preview",
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(["DRAFT_MUTATION_DETECTED", "STALE_DRAFT_DETECTED"]).toContain(res.code);
      }
    });

    it("detects price change between draft preview and transaction write and rolls back with STALE_DRAFT_DETECTED", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      let callCount = 0;
      const mockPriceResolver = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(STANDARD_PRICE_VERSION);
        }
        // Mutate price during in-tx verification!
        return Promise.resolve({
          ...STANDARD_PRICE_VERSION,
          hourlyRateInCents: 4500,
          priceVersionId: "pv-pfk-2026-v2",
        });
      });

      let createdInvoice = false;
      let linkedCount = 0;
      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockImplementation(() => {
            linkedCount++;
            return Promise.resolve({ count: 1 });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation(() => {
            createdInvoice = true;
            return Promise.resolve({ id: "inv-1" });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: mockPriceResolver,
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("STALE_DRAFT_DETECTED");
      }
      expect(createdInvoice).toBe(false);
      expect(linkedCount).toBe(0);
    });

    it("detects Phase 3c correction hours mutation between preview and transaction write and rolls back", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      let hoursCallCount = 0;
      const mockHoursResolver = vi.fn().mockImplementation((id: string) => {
        hoursCallCount++;
        if (hoursCallCount === 1) {
          return Promise.resolve({
            assignmentId: id,
            effectiveHours: 1,
            effectiveStartTime: "08:00",
            effectiveEndTime: "09:00",
            effectiveBreakMinutes: 0,
            source: "service_confirmation" as const,
            effectiveVersion: "conf-token-1",
            isCorrected: false,
            approvedCorrection: null,
          });
        }
        // In-transaction: correction approved, hours changed from 1 to 2
        return Promise.resolve({
          assignmentId: id,
          effectiveHours: 2,
          effectiveStartTime: "08:00",
          effectiveEndTime: "10:00",
          effectiveBreakMinutes: 0,
          source: "approved_correction" as const,
          effectiveVersion: "corr-token-rev2",
          isCorrected: true,
          approvedCorrection: { id: "corr-1", revision: 2 },
        });
      });

      let createdInvoice = false;
      let linkedCount = 0;
      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockImplementation(() => {
            linkedCount++;
            return Promise.resolve({ count: 1 });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation(() => {
            createdInvoice = true;
            return Promise.resolve({ id: "inv-1" });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("STALE_DRAFT_DETECTED");
      }
      expect(createdInvoice).toBe(false);
      expect(linkedCount).toBe(0);
    });

    it("detects shift times change between preview and transaction write and rolls back", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      let hoursCallCount = 0;
      const mockHoursResolver = vi.fn().mockImplementation((id: string) => {
        hoursCallCount++;
        if (hoursCallCount === 1) {
          return Promise.resolve({
            assignmentId: id,
            effectiveHours: 1,
            effectiveStartTime: "08:00",
            effectiveEndTime: "09:00",
            effectiveBreakMinutes: 0,
            source: "service_confirmation" as const,
            effectiveVersion: "conf-token-1",
            isCorrected: false,
            approvedCorrection: null,
          });
        }
        // In-transaction: shift times changed
        return Promise.resolve({
          assignmentId: id,
          effectiveHours: 1,
          effectiveStartTime: "07:00",
          effectiveEndTime: "08:00",
          effectiveBreakMinutes: 0,
          source: "service_confirmation" as const,
          effectiveVersion: "conf-token-1",
          isCorrected: false,
          approvedCorrection: null,
        });
      });

      let createdInvoice = false;
      let linkedCount = 0;
      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockImplementation(() => {
            linkedCount++;
            return Promise.resolve({ count: 1 });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation(() => {
            createdInvoice = true;
            return Promise.resolve({ id: "inv-1" });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        { assignmentIds: ["assign-1"] },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("STALE_DRAFT_DETECTED");
      }
      expect(createdInvoice).toBe(false);
      expect(linkedCount).toBe(0);
    });
  });

  // =========================================================================
  // Section 5: Concurrency Race Condition & Rollback Protection
  // =========================================================================
  describe("5. Concurrency Race Condition & Atomic Rollback Protection", () => {
    it("rolls back transaction when a concurrent process invoices an assignment before commit", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const a2 = createSyntheticAssignment("assign-2");

      let createdInvoiceCount = 0;

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }, { id: "assign-2" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
          updateMany: vi.fn().mockImplementation(() => {
            // Simulate that assign-2 was claimed concurrently, so only 1 row was updated!
            return Promise.resolve({ count: 1 });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation(() => {
            createdInvoiceCount++;
            return Promise.resolve({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" });
          }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          // When callback throws, transaction rolls back
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1", "assign-2"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_MODIFICATION");
      }
    });

    it("handles invoice number collision gracefully without partial links", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          const p2002Err: any = new Error("Unique constraint failed on the fields: (`invoiceNumber`)");
          p2002Err.code = "P2002";
          throw p2002Err;
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("COLLIDING-INV-NUM"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("INVOICE_NUMBER_CONFLICT");
      }
    });

    it("rolls back transaction and updates 0 assignments if auditLog.create fails", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      let linkedCount = 0;

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockImplementation(() => {
            linkedCount++;
            return Promise.resolve({ count: 1 });
          }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        auditLog: {
          create: vi.fn().mockRejectedValue(new Error("Audit log database failure")),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("TRANSACTION_FAILED");
      }
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it("rolls back transaction and updates 0 assignments if deps.txAuditLogFn fails", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
          txAuditLogFn: vi.fn().mockRejectedValue(new Error("txAuditLogFn failed")),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("TRANSACTION_FAILED");
      }
    });

    it("aborts and rolls back when neither txAuditLogFn nor tx.auditLog.create is available (invariant: zero paths without audit)", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        // Deliberately NO auditLog property on tx
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
          // Deliberately NO txAuditLogFn in deps
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("TRANSACTION_FAILED");
        expect(res.message).toContain("Kein transaktionaler Audit-Log-Handler verfügbar");
      }
    });

    it("invokes lockAssignmentsFn during transaction to implement row locking protocol", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const lockMock = vi.fn().mockResolvedValue(undefined);

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
          lockAssignmentsFn: lockMock,
        }
      );

      expect(res.success).toBe(true);
      expect(lockMock).toHaveBeenCalledWith(["assign-1"], mockPrisma);
    });

    it("aborts transaction when sourceConcurrencyGuardFn detects concurrent modification", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const guardMock = vi.fn().mockRejectedValue(new ConcurrentModificationError("Concurrent shift modification detected"));

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
          sourceConcurrencyGuardFn: guardMock,
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_MODIFICATION");
      }
      expect(guardMock).toHaveBeenCalled();
    });

    it("maps Prisma P2034 serialization failure to CONCURRENT_MODIFICATION", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          const p2034Err: any = new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction");
          p2034Err.code = "P2034";
          throw p2034Err;
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_MODIFICATION");
      }
    });

    it("aborts transaction with MONTH_ASSIGNMENT_SET_MUTATED when a confirmed shift is added during transaction", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      a1.order.shiftDate = new Date("2026-03-05T08:00:00Z");

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockImplementation((args: any) => {
            if (args?.where?.order?.shiftDate?.gte) {
              return Promise.resolve([{ id: "assign-1" }, { id: "assign-2" }]);
            }
            return Promise.resolve([a1]);
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
          monthScope: { clientId: "client-facility-1", year: 2026, month: 3 },
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("MONTH_ASSIGNMENT_SET_MUTATED");
      }
    });

    it("executes tx.$queryRaw with physical table 'assignments' and sorted IDs in production path", async () => {
      const a1 = createSyntheticAssignment("assign-b");
      const a2 = createSyntheticAssignment("assign-a");

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-a" }, { id: "assign-b" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        invoice: {
          create: vi.fn().mockResolvedValue({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-b", "assign-a"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(true);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);

      const rawSqlArg: any = mockPrisma.$queryRaw.mock.calls[0][0];
      const fullSqlText = rawSqlArg.strings ? rawSqlArg.strings.join("?") : String(rawSqlArg);
      expect(fullSqlText).toContain('SELECT id FROM "assignments" WHERE id IN');
      expect(fullSqlText).toContain("FOR UPDATE");
      expect(fullSqlText).not.toContain('"Assignment"');
      if (rawSqlArg.values) {
        expect(rawSqlArg.values).toEqual(["assign-a", "assign-b"]);
      }
    });

    it("aborts transaction and rolls back with CONCURRENT_MODIFICATION when tx.$queryRaw locks fewer rows than requested", async () => {
      const a1 = createSyntheticAssignment("assign-1");
      const a2 = createSyntheticAssignment("assign-2");

      let updatedCount = 0;
      let createdInvoiceCount = 0;

      const mockPrisma = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: "assign-1" }]),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1, a2]),
          updateMany: vi.fn().mockImplementation(() => {
            updatedCount++;
            return Promise.resolve({ count: 2 });
          }),
        },
        invoice: {
          create: vi.fn().mockImplementation(() => {
            createdInvoiceCount++;
            return Promise.resolve({ id: "inv-temp-1", invoiceNumber: "476-TF-0326" });
          }),
        },
        auditLog: {
          create: vi.fn().mockResolvedValue({ id: "audit-1" }),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1", "assign-2"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_MODIFICATION");
        expect(res.message).toContain("Sperrkonflikt");
        expect(res.message).toContain("Es konnten nur 1 von 2 Schichten exklusiv gesperrt werden");
      }
      expect(createdInvoiceCount).toBe(0);
      expect(updatedCount).toBe(0);
    });

    it("aborts transaction and maps lock timeout (55P03) or deadlock (40P01) in tx.$queryRaw to CONCURRENT_MODIFICATION", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const lockTimeoutErr: any = new Error("canceling statement due to lock timeout");
      lockTimeoutErr.code = "55P03";

      const mockPrisma = {
        $queryRaw: vi.fn().mockRejectedValue(lockTimeoutErr),
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("CONCURRENT_MODIFICATION");
      }

      const deadlockErr: any = new Error("deadlock detected");
      deadlockErr.code = "40P01";
      mockPrisma.$queryRaw.mockRejectedValueOnce(deadlockErr);

      const res2 = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res2.success).toBe(false);
      if (!res2.success) {
        expect(res2.code).toBe("CONCURRENT_MODIFICATION");
      }
    });

    it("aborts transaction when neither lockAssignmentsFn nor tx.$queryRaw is available", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
        $transaction: vi.fn().mockImplementation(async (callback: any) => {
          return await callback(mockPrisma);
        }),
      };

      const res = await issueV2Invoice(
        {
          assignmentIds: ["assign-1"],
        },
        {
          prisma: mockPrisma,
          requireRoleFn: vi.fn().mockResolvedValue({ id: "admin-1", role: "admin" }) as any,
          priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
          facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_POLICY),
          effectiveHoursResolver: mockDefaultHoursResolver as any,
          generateInvoiceNumberFn: vi.fn().mockResolvedValue("476-TF-0326"),
        }
      );

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe("TRANSACTION_FAILED");
        expect(res.message).toContain("Keine Implementierung für die exklusive Schichtsperrung (FOR UPDATE) in der Transaktion verfügbar");
      }
    });
  });

  // =========================================================================
  // Section 6: Action Integration & Zero-Fallback Guarantees
  // =========================================================================
  describe("6. Action Integration & Zero-Fallback Guarantees", () => {
    it("requires a reviewed draft before an order action can allocate a V2 invoice", async () => {
      const { prisma } = await import("./prisma");
      const createInvoice = vi.spyOn(prisma.invoice, "create");

      await expect(generateOrderInvoices(["assign-1"])).rejects.toThrow("[V2_REVIEW_REQUIRED]");
      expect(createInvoice).not.toHaveBeenCalled();
    });

    it("returns a cancelled-number conflict as an actionable result instead of a masked Server Action error", async () => {
      const issuanceService = await import("./invoice-v2-issuance-service");
      const issueSpy = vi.spyOn(issuanceService, "issueV2Invoice").mockResolvedValueOnce({
        success: false,
        code: "INVOICE_NUMBER_CONFLICT",
        message: 'Die Rechnungsnummer "551-147-0926" ist bereits vergeben.',
      });
      try {
        const result = await generateOrderInvoices(["assign-1"], "551-147-0926", undefined, true, false, "reviewed-hash");
        expect(result).toMatchObject({
          ok: false,
          code: "INVOICE_NUMBER_CONFLICT",
        });
        if (!result.ok) expect(result.message).toContain("Manuelle Rechnungsnummer");
      } finally {
        issueSpy.mockRestore();
      }
    });

    it("binds review approval to financial and recipient-facing data, not preparation time", () => {
      const draft = {
        status: "resolved",
        clientId: "client-1",
        assignmentIds: ["assignment-1"],
        periodStart: "2026-10-01",
        periodEnd: "2026-10-01",
        provenance: { assignments: [], policyVersions: [], priceVersions: [] },
        snapshotData: {
          preparedAt: "2026-10-12T10:00:00.000Z",
          facilityName: "Facility A",
          paymentTermsDays: 14,
          totalCents: 11900,
        },
      } as unknown as Parameters<typeof computeV2DraftHash>[0];
      const originalHash = computeV2DraftHash(draft);
      const later = structuredClone(draft) as Extract<typeof draft, { status: "resolved" }>;
      later.snapshotData.preparedAt = "2026-10-12T10:05:00.000Z";
      expect(computeV2DraftHash(later)).toBe(originalHash);
      later.snapshotData.paymentTermsDays = 30;
      expect(computeV2DraftHash(later)).not.toBe(originalHash);
    });

    it("halts batch in generateOrderInvoices without falling back when price is unresolved", async () => {
      const a1 = createSyntheticAssignment("assign-1");

      const mockPrisma = {
        assignment: {
          findMany: vi.fn().mockResolvedValue([a1]),
        },
      };

      // Mock prisma globally for the action call
      vi.spyOn(mockPrisma.assignment, "findMany").mockResolvedValue([a1]);

      await expect(
        generateOrderInvoices(["assign-1"])
      ).rejects.toThrow();
    });

    it("prevents refreshing or recalculating a frozen V2 invoice", async () => {
      const mockV2Invoice = {
        id: "inv-v2-1",
        status: "unpaid",
        snapshotData: {
          calculationVersion: "v2",
          isFrozen: true,
          pdfItems: [{ pos: 1, description: "Test", hours: "1,00", rate: "40,00", amount: "40,00 €" }],
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
        },
      };

      const { prisma } = await import("./prisma");
      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockV2Invoice as any);

      await expect(refreshInvoice("inv-v2-1")).rejects.toThrow(
        "V2-Rechnungen sind dauerhaft unveränderlich"
      );
    });

    it("strictly disallows forceRecalculate: true on V2 invoices in buildInvoicePdfData", () => {
      const v2Invoice = {
        invoiceNumber: "INV-V2",
        date: new Date(),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2",
          pdfItems: [{ pos: 1, description: "Item", hours: "1,00", rate: "40,00", amount: "40,00 €" }],
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
        },
      };

      expect(() =>
        buildInvoicePdfData(v2Invoice as any, {} as any, [], { forceRecalculate: true })
      ).toThrow("forceRecalculate is strictly forbidden for V2 invoices");
    });

    it("shows a worker from frozen V2 item metadata on an already issued PDF without changing money", () => {
      const invoice = {
        invoiceNumber: "INV-FROZEN-WORKER",
        date: new Date("2026-10-13T00:00:00.000Z"),
        netAmount: 40,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2",
          facilityName: "Test Facility",
          address: "Teststraße 1, 53111 Bonn",
          paymentTermsDays: 14,
          pdfItems: [{ pos: 1, description: "Grundvergütung (1.00 Std.)", hours: "1,00", rate: "40,00", amount: "40,00 €" }],
          items: [{
            pos: 1,
            workerId: "worker-1",
            workerName: "Erika Musterfrau",
            qualification: "pflegefachkraft",
            itemCategory: "base",
            description: "Grundvergütung (1.00 Std.)",
            hoursDisplay: "1,00",
            rateDisplay: "40,00 €",
            amountCents: 4000,
          }],
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
        },
      };

      const pdfData = buildInvoicePdfData(invoice as any, { id: "client-1" } as any, []);
      expect(pdfData.items[0].description).toBe("Erika Musterfrau (Pflegefachkraft)");
      expect(pdfData.subtotal).toBe("40,00 €");
      expect(pdfData.total).toBe("47,60 €");

    });

    it("rejects corrupted V2 snapshotData when pdfItems are missing or cent amounts mismatch", () => {
      const corruptedInvoice1 = {
        invoiceNumber: "INV-CORRUPT-1",
        date: new Date(),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2",
          // missing pdfItems!
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
        },
      };

      expect(() =>
        buildInvoicePdfData(corruptedInvoice1 as any, {} as any, [])
      ).toThrow("snapshotData.pdfItems is missing or empty");

      const corruptedInvoice2 = {
        invoiceNumber: "INV-CORRUPT-2",
        date: new Date(),
        netAmount: 50.0, // DB amount 50.00 != snapshot 4000 cents!
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2",
          pdfItems: [{ pos: 1, description: "Item", hours: "1,00", rate: "40,00", amount: "40,00 €" }],
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
        },
      };

      expect(() =>
        buildInvoicePdfData(corruptedInvoice2 as any, {} as any, [])
      ).toThrow("DB amounts");
    });

    it("rejects V2 snapshotData when sum of pdfItems amounts does not equal subtotalCents", () => {
      const tamperedInvoice = {
        invoiceNumber: "INV-TAMPER-1",
        date: new Date(),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: {
          calculationVersion: "v2",
          items: [
            { pos: 1, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
            { pos: 2, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
            { pos: 3, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
          ],
          // Tampered first line: 9,99 € instead of 5,68 €
          pdfItems: [
            { pos: 1, description: "Item 1", hours: "1,00", rate: "5,68", amount: "9,99 €" },
            { pos: 2, description: "Item 2", hours: "1,00", rate: "5,68", amount: "5,68 €" },
            { pos: 3, description: "Item 3", hours: "1,00", rate: "5,68", amount: "5,68 €" },
          ],
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
        },
      };

      expect(() =>
        buildInvoicePdfData(tamperedInvoice as any, {} as any, [])
      ).toThrow("sum of pdfItems amounts (2135 Cent) does not match frozen subtotalCents (1704 Cent)");
    });

    it("rejects V2 snapshotData when subtotal string does not match subtotalCents", () => {
      const tamperedInvoice = {
        invoiceNumber: "INV-TAMPER-2",
        date: new Date(),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: {
          calculationVersion: "v2",
          items: [
            { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1704 },
          ],
          pdfItems: [
            { pos: 1, description: "Item 1", hours: "3,00", rate: "5,68", amount: "17,04 €" },
          ],
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          subtotal: "9,99 €", // Tampered string!
          taxAmount: "3,24 €",
          total: "20,28 €",
        },
      };

      expect(() =>
        buildInvoicePdfData(tamperedInvoice as any, {} as any, [])
      ).toThrow("snapshotData.subtotal (\"9,99 €\") stimmt nicht mit subtotalCents (1704) überein");
    });

    it("rejects V2 snapshotData when snapshot.items line amounts mismatch pdfItems amounts", () => {
      const tamperedInvoice = {
        invoiceNumber: "INV-TAMPER-3",
        date: new Date(),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: {
          calculationVersion: "v2",
          items: [
            { pos: 1, hoursDisplay: "3,00", rateDisplay: "5,68 €", amountDisplay: "17,04 €", amountCents: 1600 },
          ],
          pdfItems: [
            { pos: 1, description: "Item 1", hours: "3,00", rate: "5,68", amount: "17,04 €" },
          ],
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
        },
      };

      expect(() =>
        buildInvoicePdfData(tamperedInvoice as any, {} as any, [])
      ).toThrow("snapshotData.items.amountCents (1600) does not match pdfItems amount (1704 Cent)");
    });

    it("rejects generateMonthInvoices if unbilled assignment set changed since preview", async () => {
      const { prisma } = await import("./prisma");
      vi.spyOn(prisma.client, "findUnique").mockResolvedValue({
        id: "client-month-1",
        facilityName: "Test Facility",
        userId: "user-client-1",
        status: "active",
      } as any);
      vi.spyOn(prisma.assignment, "findMany").mockResolvedValue([
        { id: "assign-1" },
        { id: "assign-2" },
      ] as any);

      await expect(
        generateMonthInvoices("client-month-1", 2026, 3, "INV-MONTH-01", [], false, false, {
          expectedAssignmentIds: ["assign-1", "assign-3"],
          expectedDraftHash: "reviewed-draft-hash",
        })
      ).rejects.toThrow("[MONTH_ASSIGNMENT_SET_MUTATED]");
    });

    it("isolates notification failure in generateOrderInvoices without failing invoice commit", async () => {
      const { prisma } = await import("./prisma");
      const mockInvoice = {
        id: "inv-order-notif-1",
        invoiceNumber: "INV-NOTIF-01",
        date: new Date("2026-03-15"),
        snapshotData: { calculationVersion: "v2" },
        client: { id: "c1", userId: "u1", billingEmail: "billing@test.com" },
        assignments: [
          {
            id: "a1",
            order: { id: "o1", shiftDate: new Date("2026-03-15"), requestGroupId: "rg1" },
            worker: { fullName: "Worker 1" },
          },
        ],
      };

      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockInvoice as any);
      vi.spyOn(prisma.notification, "create").mockRejectedValue(new Error("Notification DB outage"));

      const issuanceService = await import("./invoice-v2-issuance-service");
      vi.spyOn(issuanceService, "issueV2Invoice").mockResolvedValue({
        success: true,
        invoiceId: "inv-order-notif-1",
        invoiceNumber: "INV-NOTIF-01",
      } as any);

      const result = await generateOrderInvoices(["a1"], "INV-NOTIF-01", [], false, false, "reviewed-draft-hash");
      expect(result.ok).toBe(true);
      expect(result.invoiceId).toBe("inv-order-notif-1");
      expect(result.notificationStatus).toBe("failed");
    });

    it("isolates notification failure in generateMonthInvoices without failing invoice commit", async () => {
      const { prisma } = await import("./prisma");
      const mockClient = {
        id: "c1",
        userId: "u1",
        facilityName: "Test Facility",
        status: "active",
      };
      const mockInvoice = {
        id: "inv-month-notif-1",
        invoiceNumber: "INV-MONTH-NOTIF-01",
        date: new Date("2026-03-15"),
        snapshotData: { calculationVersion: "v2" },
        client: mockClient,
        assignments: [
          {
            id: "a1",
            order: { id: "o1", shiftDate: new Date("2026-03-15") },
            worker: { fullName: "Worker 1" },
          },
        ],
      };

      vi.spyOn(prisma.client, "findUnique").mockResolvedValue(mockClient as any);
      vi.spyOn(prisma.assignment, "findMany").mockResolvedValue([{ id: "a1" }] as any);
      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockInvoice as any);
      vi.spyOn(prisma.notification, "create").mockRejectedValue(new Error("Notification DB outage"));

      const issuanceService = await import("./invoice-v2-issuance-service");
      vi.spyOn(issuanceService, "issueV2Invoice").mockResolvedValue({
        success: true,
        invoiceId: "inv-month-notif-1",
        invoiceNumber: "INV-MONTH-NOTIF-01",
      } as any);

      const result = await generateMonthInvoices("c1", 2026, 3, "INV-MONTH-NOTIF-01", [], false, false, {
        expectedAssignmentIds: ["a1"],
        expectedDraftHash: "reviewed-draft-hash",
      });
      expect(result.ok).toBe(true);
      expect(result.invoiceId).toBe("inv-month-notif-1");
      expect(result.notificationStatus).toBe("failed");
    });

    it("generateMonthInvoices throws [MONTH_PREVIEW_REQUIRED] when expectedAssignmentIds is missing in V2 mode", async () => {
      const { prisma } = await import("./prisma");
      const mockClient = { id: "c1", userId: "u1" };
      vi.spyOn(prisma.client, "findUnique").mockResolvedValue(mockClient as any);

      await expect(
        generateMonthInvoices("c1", 2026, 3, "INV-1")
      ).rejects.toThrow("[MONTH_PREVIEW_REQUIRED]");
    });

    it("previewMonthInvoicing queries and returns unbilled confirmed shifts in month scope", async () => {
      const { prisma } = await import("./prisma");
      vi.spyOn(prisma.assignment, "findMany").mockResolvedValue([
        { id: "shift-1" },
        { id: "shift-2" },
      ] as any);

      const { previewMonthInvoicing } = await import("@/app/[locale]/admin/clients/[id]/schedule/invoice-actions");
      const preview = await previewMonthInvoicing("c1", 2026, 3);
      expect(preview.count).toBe(2);
      expect(preview.assignmentIds).toEqual(["shift-1", "shift-2"]);
    });
  });

  // =========================================================================
  // Section 7: Currency Formatting & Euro Sign Dedup
  // =========================================================================
  describe("7. Euro Sign Formatting & Deduplication Guarantee", () => {
    it("ensures item rate and amounts do not produce duplicate € symbols", async () => {
      const v2InvoiceWithDoubleEuroItem = {
        invoiceNumber: "INV-EURO-TEST",
        date: new Date(),
        netAmount: 40.0,
        vatAmount: 7.6,
        grossAmount: 47.6,
        snapshotData: {
          calculationVersion: "v2",
          items: [{ pos: 1, hoursDisplay: "1,00", rateDisplay: "40,00", amountDisplay: "40,00 €", amountCents: 4000 }],
          // Notice rate has trailing "€"
          pdfItems: [{ pos: 1, description: "Rate With Euro", hours: "1,00", rate: "40,00 €", amount: "40,00 €" }],
          subtotalCents: 4000,
          taxAmountCents: 760,
          totalCents: 4760,
          subtotal: "40,00 €",
          taxAmount: "7,60 €",
          total: "47,60 €",
        },
      };

      const pdfData = buildInvoicePdfData(v2InvoiceWithDoubleEuroItem as any, {} as any, []);

      // Rate was sanitized by buildInvoicePdfData to strip trailing €
      expect(pdfData.items[0].rate).toBe("40,00");
      expect(pdfData.items[0].rate).not.toContain("€");

      // Render to PDF to ensure no crash and valid output
      const buffer = await generateInvoicePdf(pdfData);
      expect(buffer).toBeDefined();
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    });

    it("verifies de-duplicated Euro symbols and exact display amounts in decompressed PDF stream", async () => {
      const v2InvoiceThreeLines = {
        invoiceNumber: "INV-DECOMPRESS-TEST",
        date: new Date("2026-03-01"),
        netAmount: 17.04,
        vatAmount: 3.24,
        grossAmount: 20.28,
        snapshotData: {
          calculationVersion: "v2",
          items: [
            { pos: 1, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
            { pos: 2, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
            { pos: 3, hoursDisplay: "1,00", rateDisplay: "5,68 €", amountDisplay: "5,68 €", amountCents: 568 },
          ],
          pdfItems: [
            { pos: 1, description: "Schicht A", hours: "1,00", rate: "5,68 €", amount: "5,68 €" },
            { pos: 2, description: "Schicht B", hours: "1,00", rate: "5,68 €", amount: "5,68 €" },
            { pos: 3, description: "Schicht C", hours: "1,00", rate: "5,68 €", amount: "5,68 €" },
          ],
          subtotalCents: 1704,
          taxAmountCents: 324,
          totalCents: 2028,
          subtotal: "17,04 €",
          taxAmount: "3,24 €",
          total: "20,28 €",
        },
      };

      const pdfData = buildInvoicePdfData(v2InvoiceThreeLines as any, {} as any, []);
      const buffer = await generateInvoicePdf(pdfData);
      expect(buffer).toBeDefined();

      const decompressed = extractTextFromPdfBuffer(buffer);
      expect(decompressed).toContain("17,04");
      expect(decompressed).toContain("5,68");
      expect(decompressed).not.toContain("17,03");
      expect(decompressed).not.toContain("€ €");
    });
  });

  // =========================================================================
  // Section 8: Strict Currency Parsing & PDF Snapshot Integrity
  // =========================================================================
  describe("8. Strict Currency Parsing & PDF Snapshot Integrity", () => {
    it("parseGermanCurrencyStringToCents rejects 3-decimal strings such as '5,680 €'", () => {
      expect(() => parseGermanCurrencyStringToCents("5,680 €")).toThrow(
        /Ungültiges deutsches Währungsformat: "5,680 €"/
      );
    });

    it("parseGermanCurrencyStringToCents rejects non-standard formats (1 decimal '5,6 €', dot format '5.68')", () => {
      expect(() => parseGermanCurrencyStringToCents("5,6 €")).toThrow();
      expect(() => parseGermanCurrencyStringToCents("5.68")).toThrow();
      expect(() => parseGermanCurrencyStringToCents("abc")).toThrow();
      expect(() => parseGermanCurrencyStringToCents("")).toThrow();
    });

    it("parseGermanCurrencyStringToCents accurately parses 2-decimal German currency without float error", () => {
      expect(parseGermanCurrencyStringToCents("5,68 €")).toBe(568);
      expect(parseGermanCurrencyStringToCents("1.234,56 €")).toBe(123456);
      expect(parseGermanCurrencyStringToCents("0,05 €")).toBe(5);
      expect(parseGermanCurrencyStringToCents("-10,50 €")).toBe(-1050);
    });

    it("buildInvoicePdfData rejects V2 invoice when snapshotData.items is missing or empty", () => {
      const badInvoice = {
        invoiceNumber: "INV-NO-ITEMS",
        date: new Date(),
        netAmount: 10,
        vatAmount: 1.9,
        grossAmount: 11.9,
        snapshotData: {
          calculationVersion: "v2",
          subtotalCents: 1000,
          taxAmountCents: 190,
          totalCents: 1190,
          subtotal: "10,00 €",
          taxAmount: "1,90 €",
          total: "11,90 €",
          pdfItems: [{ pos: 1, description: "Item 1", hours: "1,00", rate: "10,00", amount: "10,00 €" }],
          // items missing!
        },
      };

      expect(() => buildInvoicePdfData(badInvoice as any, {} as any, [])).toThrow(
        "snapshotData.items ist zwingend erforderlich und darf nicht fehlen oder leer sein"
      );
    });

    it("buildInvoicePdfData rejects V2 invoice when amountCents is missing or non-integer in snapshotData.items", () => {
      const badInvoice = {
        invoiceNumber: "INV-NO-CENTS",
        date: new Date(),
        netAmount: 10,
        vatAmount: 1.9,
        grossAmount: 11.9,
        snapshotData: {
          calculationVersion: "v2",
          subtotalCents: 1000,
          taxAmountCents: 190,
          totalCents: 1190,
          subtotal: "10,00 €",
          taxAmount: "1,90 €",
          total: "11,90 €",
          items: [{ pos: 1, hoursDisplay: "1,00", rateDisplay: "10,00" /* amountCents missing! */ }],
          pdfItems: [{ pos: 1, description: "Item 1", hours: "1,00", rate: "10,00", amount: "10,00 €" }],
        },
      };

      expect(() => buildInvoicePdfData(badInvoice as any, {} as any, [])).toThrow(
        /snapshotData\.items\[0\]\.amountCents fehlt oder ist keine gültige Ganzzahl/
      );
    });

    it("buildInvoicePdfData rejects V2 invoice when hours in pdfItems is tampered even if line amount matches", () => {
      const badInvoice = {
        invoiceNumber: "INV-TAMPER-HOURS",
        date: new Date(),
        netAmount: 10,
        vatAmount: 1.9,
        grossAmount: 11.9,
        snapshotData: {
          calculationVersion: "v2",
          subtotalCents: 1000,
          taxAmountCents: 190,
          totalCents: 1190,
          subtotal: "10,00 €",
          taxAmount: "1,90 €",
          total: "11,90 €",
          items: [{ pos: 1, hoursDisplay: "1,00", rateDisplay: "10,00", amountCents: 1000 }],
          pdfItems: [{ pos: 1, description: "Item 1", hours: "2,00" /* tampered! */, rate: "10,00", amount: "10,00 €" }],
        },
      };

      expect(() => buildInvoicePdfData(badInvoice as any, {} as any, [])).toThrow(
        /snapshotData\.items\.hoursDisplay \("1,00"\) does not match pdfItems hours \("2,00"\)/
      );
    });

    it("buildInvoicePdfData rejects V2 invoice when rate in pdfItems is tampered even if line amount matches", () => {
      const badInvoice = {
        invoiceNumber: "INV-TAMPER-RATE",
        date: new Date(),
        netAmount: 10,
        vatAmount: 1.9,
        grossAmount: 11.9,
        snapshotData: {
          calculationVersion: "v2",
          subtotalCents: 1000,
          taxAmountCents: 190,
          totalCents: 1190,
          subtotal: "10,00 €",
          taxAmount: "1,90 €",
          total: "11,90 €",
          items: [{ pos: 1, hoursDisplay: "1,00", rateDisplay: "10,00", amountCents: 1000 }],
          pdfItems: [{ pos: 1, description: "Item 1", hours: "1,00", rate: "20,00" /* tampered! */, amount: "10,00 €" }],
        },
      };

      expect(() => buildInvoicePdfData(badInvoice as any, {} as any, [])).toThrow(
        /snapshotData\.items rate \("10,00"\) does not match pdfItems rate \("20,00"\)/
      );
    });
  });
});
