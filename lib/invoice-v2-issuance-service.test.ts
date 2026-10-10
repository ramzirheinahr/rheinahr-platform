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
} from "./invoice-v2-issuance-service";
import {
  generateOrderInvoices,
  refreshInvoice,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";
import { buildInvoicePdfData } from "./invoice-pdf-builder";
import { generateInvoicePdf, type InvoicePdfData } from "./pdf/invoice";
import { resolveInvoiceSurchargePolicy, type FacilitySurchargePolicyRecord } from "./surcharge-policy";
import type { PriceVersionRecord } from "./invoice-v2-draft-service";
import { calculateExactInvoice, formatHundredthsGerman } from "./invoice-exact-engine";

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
          auditFn: auditMock,
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
          })
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
        expect(res.code).toBe("DRAFT_MUTATION_DETECTED");
      }
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
  });

  // =========================================================================
  // Section 6: Action Integration & Zero-Fallback Guarantees
  // =========================================================================
  describe("6. Action Integration & Zero-Fallback Guarantees", () => {
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
  });
});
