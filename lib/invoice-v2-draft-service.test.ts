import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  prepareV2InvoiceDraft,
  type PrepareV2InvoiceDraftInput,
  type V2DraftDependencies,
  type PriceVersionRecord,
} from "./invoice-v2-draft-service";
import {
  resolveInvoiceSurchargePolicy,
  type FacilitySurchargePolicyRecord,
  type ResolvedSurchargePolicySuccess,
} from "./surcharge-policy";
import type { VerifiedContractBreakAllocationClause } from "./shift-minute-splitter";

// Deterministic mock policy builder with authentic canonical hash
function createTestFrozenPolicy(
  overrides?: Partial<FacilitySurchargePolicyRecord>
): ResolvedSurchargePolicySuccess {
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
    ...overrides,
  };

  const resolved = resolveInvoiceSurchargePolicy({
    policy: baseRecord,
    referenceDate: "2026-03-01",
  });

  if (resolved.status !== "resolved") {
    throw new Error(`Failed to resolve test policy: ${resolved.message}`);
  }

  const frozenRecord: FacilitySurchargePolicyRecord = {
    ...baseRecord,
    isFrozen: true,
    frozenHash: resolved.frozenHash,
  };

  const frozenRes = resolveInvoiceSurchargePolicy({
    policy: frozenRecord,
    referenceDate: "2026-03-01",
  });

  if (frozenRes.status !== "resolved") {
    throw new Error(`Failed to freeze test policy: ${frozenRes.message}`);
  }

  return frozenRes;
}

const FROZEN_NRW_POLICY = createTestFrozenPolicy();

// Reusable standard price version record
const STANDARD_PRICE_VERSION: PriceVersionRecord = {
  priceVersionId: "pv-pfk-2026-v1",
  clientId: "client-facility-1",
  qualification: "pflegefachkraft",
  hourlyRateInCents: 4000, // 40.00 €/h
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  contractId: "contract-1",
  sourceReference: "Preisvereinbarung § 3 vom 01.01.2026",
  verifiedAt: "2026-01-01T10:00:00.000Z",
  verifiedBy: "admin-user-1",
};

// Helper to create mock database client with pure synthetic records
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockPrisma(assignments: any[]) {
  return {
    assignment: {
      findMany: vi.fn().mockResolvedValue(assignments),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    facilitySurchargePolicy: {
      findFirst: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
    },
  };
}

describe("V2 Invoice Preparation Service (Phase 5a - Pure Read-Only Draft)", () => {
  // ─────────────────────────────────────────────────────────────
  // 1. Synthetic 60 min Saturday shift at 40€/h + 25% = 50.00€
  // ─────────────────────────────────────────────────────────────
  it("Benchmark 1: 60-min Saturday shift at 40.00 €/h + 25% yields exact 50.00 € net, 9.50 € VAT, 59.50 € gross", async () => {
    // Saturday 2026-03-07, 10:00 - 11:00 (60 min)
    const mockAssignment = {
      id: "asg-sat-60",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-1", fullName: "Erika Musterfrau", qualification: "pflegefachkraft" },
      order: {
        id: "ord-sat-60",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-07T00:00:00.000Z"),
        startTime: "10:00",
        endTime: "11:00",
        breakMinutes: 0,
        requiredQualification: "pflegefachkraft",
        client: {
          id: "client-facility-1",
          facilityName: "Seniorenresidenz Rheinblick",
          internalNumber: "KD-1001",
          shortCode: "SRB",
          address: "Rheinufer 12, 53424 Remagen",
          billingEmail: "buchhaltung@rheinblick.de",
          billingInfo: "USt-IdNr: DE123456789",
          paymentTermsDays: 14,
        },
      },
    };

    const mockPrisma = createMockPrisma([mockAssignment]);

    const deps: V2DraftDependencies = {
      prisma: mockPrisma,
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-sat-60",
        effectiveHours: 1.0,
        effectiveStartTime: "10:00",
        effectiveEndTime: "11:00",
        effectiveBreakMinutes: 0,
        source: "scheduled",
        effectiveVersion: "v1-scheduled",
        isCorrected: false,
      }),
    };

    const input: PrepareV2InvoiceDraftInput = {
      assignmentIds: ["asg-sat-60"],
    };

    const result = await prepareV2InvoiceDraft(input, deps);

    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.calculationVersion).toBe("v2");
    expect(result.shiftCount).toBe(1);
    expect(result.clientId).toBe("client-facility-1");
    expect(result.periodStart).toBe("2026-03-07");
    expect(result.periodEnd).toBe("2026-03-07");
    expect(result.periodDisplay).toBe("07.03.2026");

    // Two line items: Base (100%) and Saturday Surcharge (+25%)
    expect(result.items).toHaveLength(2);

    const baseItem = result.items.find((i) => i.itemCategory === "base");
    expect(baseItem).toBeDefined();
    expect(baseItem?.rawMinutes).toBe(60);
    expect(baseItem?.displayHourHundredths).toBe(100); // 1.00 h
    expect(baseItem?.hoursDisplay).toBe("1,00");
    expect(baseItem?.rateCents).toBe(4000); // 40.00 €
    expect(baseItem?.rateDisplay).toBe("40,00 €");
    expect(baseItem?.amountCents).toBe(4000); // 40.00 €
    expect(baseItem?.amountDisplay).toBe("40,00 €");

    const satItem = result.items.find((i) => i.itemCategory === "surcharge_saturday");
    expect(satItem).toBeDefined();
    expect(satItem?.rawMinutes).toBe(60);
    expect(satItem?.displayHourHundredths).toBe(100); // 1.00 h
    expect(satItem?.hoursDisplay).toBe("1,00");
    expect(satItem?.rateCents).toBe(1000); // +25% of 40.00 € = 10.00 €
    expect(satItem?.rateDisplay).toBe("10,00 €");
    expect(satItem?.amountCents).toBe(1000); // 10.00 €
    expect(satItem?.amountDisplay).toBe("10,00 €");

    // Exact Totals
    expect(result.totals.subtotalCents).toBe(5000); // 50.00 €
    expect(result.totals.subtotalDisplay).toBe("50,00 €");
    expect(result.totals.taxAmountCents).toBe(950); // 19% of 50.00 € = 9.50 €
    expect(result.totals.taxAmountDisplay).toBe("9,50 €");
    expect(result.totals.totalCents).toBe(5950); // 59.50 €
    expect(result.totals.totalDisplay).toBe("59,50 €");

    // Mathematical Invariants: Subtotal equals exact sum of line items
    const sumLines = result.items.reduce((s, it) => s + it.amountCents, 0);
    expect(result.totals.subtotalCents).toBe(sumLines);
    expect(result.totals.totalCents).toBe(result.totals.subtotalCents + result.totals.taxAmountCents);

    // Snapshot Data matches exact totals and is frozen
    expect(result.snapshotData.calculationVersion).toBe("v2");
    expect(result.snapshotData.subtotal).toBe("50,00 €");
    expect(result.snapshotData.taxAmount).toBe("9,50 €");
    expect(result.snapshotData.total).toBe("59,50 €");
    expect(result.snapshotData.subtotalCents).toBe(5000);
    expect(result.snapshotData.taxAmountCents).toBe(950);
    expect(result.snapshotData.totalCents).toBe(5950);
    expect(result.snapshotData.isFrozen).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Irregular minutes where display hours * display rate = line cents
  // ─────────────────────────────────────────────────────────────
  it("computes line item amount strictly from displayed hours and displayed rate (DIN 1333 commercial rounding)", async () => {
    // 73 minutes on weekday at 52.80 €/h
    // 73 * 100 / 60 = 121.666... -> 122 hundredths (1.22 h)
    // 122 * 5280 / 100 = 6441.6 -> 6442 cents (64.42 €)
    // 1.22 h * 52.80 €/h = 64.416 -> 64.42 €
    const mockAssignment = {
      id: "asg-73-min",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-2", fullName: "Ahmed Al-Mansoor", qualification: "pflegefachkraft" },
      order: {
        id: "ord-73-min",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-04T00:00:00.000Z"), // Wednesday
        startTime: "08:00",
        endTime: "09:13", // 73 min
        breakMinutes: 0,
        requiredQualification: "pflegefachkraft",
        client: {
          id: "client-facility-1",
          facilityName: "Seniorenresidenz Rheinblick",
          paymentTermsDays: 14,
        },
      },
    };

    const price5280: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      hourlyRateInCents: 5280, // 52.80 €/h
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(price5280),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-73-min",
        effectiveHours: 73 / 60,
        effectiveStartTime: "08:00",
        effectiveEndTime: "09:13",
        effectiveBreakMinutes: 0,
        source: "scheduled",
        effectiveVersion: "v1-73m",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-73-min"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.rawMinutes).toBe(73);
    expect(item.displayHourHundredths).toBe(122);
    expect(item.hoursDisplay).toBe("1,22");
    expect(item.rateCents).toBe(5280);
    expect(item.rateDisplay).toBe("52,80 €");
    expect(item.amountCents).toBe(6442);
    expect(item.amountDisplay).toBe("64,42 €");
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Two shifts for same worker aggregated before hour rounding
  // ─────────────────────────────────────────────────────────────
  it("aggregates raw minutes before rounding for the same worker across two shifts", async () => {
    // Shift 1: 50 min (08:00–08:50)
    // Shift 2: 40 min (10:00–10:40)
    // Total raw minutes: 90 min (1.50 h).
    // If rounded separately: 50m -> 0.83h (33.20 €), 40m -> 0.67h (26.80 €)
    // Sum = 90 min = exactly 1.50 h × 40.00 € = 60.00 € (6000 cents)
    const asg1 = {
      id: "asg-w1-50m",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-shared", fullName: "Hans Becker", qualification: "pflegefachkraft" },
      order: {
        id: "ord-1",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "08:50",
        breakMinutes: 0,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const asg2 = {
      id: "asg-w1-40m",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-shared", fullName: "Hans Becker", qualification: "pflegefachkraft" },
      order: {
        id: "ord-2",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "10:00",
        endTime: "10:40",
        breakMinutes: 0,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([asg1, asg2]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockImplementation((id: string) => {
        if (id === "asg-w1-50m") {
          return {
            assignmentId: id,
            effectiveHours: 50 / 60,
            effectiveStartTime: "08:00",
            effectiveEndTime: "08:50",
            effectiveBreakMinutes: 0,
            source: "scheduled",
            effectiveVersion: "v1-50m",
            isCorrected: false,
          };
        }
        return {
          assignmentId: id,
          effectiveHours: 40 / 60,
          effectiveStartTime: "10:00",
          effectiveEndTime: "10:40",
          effectiveBreakMinutes: 0,
          source: "scheduled",
          effectiveVersion: "v1-40m",
          isCorrected: false,
        };
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-w1-50m", "asg-w1-40m"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    // Must be aggregated into ONE base line item
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.workerId).toBe("w-shared");
    expect(item.rawMinutes).toBe(90);
    expect(item.displayHourHundredths).toBe(150);
    expect(item.hoursDisplay).toBe("1,50");
    expect(item.amountCents).toBe(6000);
    expect(item.amountDisplay).toBe("60,00 €");
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Two workers with identical names distinguished by workerId
  // ─────────────────────────────────────────────────────────────
  it("keeps workers with identical names strictly separated by workerId", async () => {
    const asgA = {
      id: "asg-dup-name-a",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "worker-uuid-1", fullName: "Max Mustermann", qualification: "pflegefachkraft" },
      order: {
        id: "ord-a",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const asgB = {
      id: "asg-dup-name-b",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "worker-uuid-2", fullName: "Max Mustermann", qualification: "pflegefachkraft" },
      order: {
        id: "ord-b",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([asgA, asgB]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockImplementation((id: string) => ({
        assignmentId: id,
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1-8h",
        isCorrected: false,
      })),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-dup-name-a", "asg-dup-name-b"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    // Both workers produce separate line items
    expect(result.items).toHaveLength(2);
    expect(result.items[0].workerId).toBe("worker-uuid-1");
    expect(result.items[1].workerId).toBe("worker-uuid-2");
    expect(result.items[0].pos).toBe(1);
    expect(result.items[1].pos).toBe(2);
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Different qualifications / price versions split into separate lines
  // ─────────────────────────────────────────────────────────────
  it("splits different qualifications or price versions for the same worker into distinct line items", async () => {
    const asgPfk = {
      id: "asg-pfk",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-multi-qual", fullName: "Sarah Schmidt", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pfk",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const asgPfh = {
      id: "asg-pfh",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-multi-qual", fullName: "Sarah Schmidt", qualification: "pflegehelfer" },
      order: {
        id: "ord-pfh",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegehelfer",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const priceResolver = vi.fn().mockImplementation(({ qualification }) => {
      if (qualification === "pflegefachkraft") {
        return STANDARD_PRICE_VERSION;
      }
      return {
        priceVersionId: "pv-pfh-2026-v1",
        clientId: "client-facility-1",
        qualification: "pflegehelfer",
        hourlyRateInCents: 3000, // 30.00 €/h
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        contractId: "contract-1",
        sourceReference: "Preisvereinbarung § 3 Pflegehelfer",
        verifiedAt: "2026-01-01T10:00:00.000Z",
        verifiedBy: "admin-user-1",
      };
    });

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([asgPfk, asgPfh]),
      priceVersionResolver: priceResolver,
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockImplementation((id: string) => ({
        assignmentId: id,
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1-8h",
        isCorrected: false,
      })),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-pfk", "asg-pfh"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.items).toHaveLength(2);
    expect(result.items.some((i) => i.qualification === "pflegefachkraft" && i.rateCents === 4000)).toBe(true);
    expect(result.items.some((i) => i.qualification === "pflegehelfer" && i.rateCents === 3000)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Approved Phase 3c correction used instead of scheduled times
  // ─────────────────────────────────────────────────────────────
  it("uses approved Phase 3c correction hours and times rather than scheduled times", async () => {
    // Scheduled was 08:00–16:30 (8.0 h), but approved correction changed to 08:00–14:30 (6.0 h)
    const mockAssignment = {
      id: "asg-corrected",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-corr", fullName: "Julia Wagner", qualification: "pflegefachkraft" },
      order: {
        id: "ord-sched-8h",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-05T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30", // scheduled 8.0h
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-corrected",
        effectiveHours: 6.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "14:30", // 6.5h gross - 30m break = 6.0h net
        effectiveBreakMinutes: 30,
        source: "approved_correction",
        effectiveVersion: "v2-correction-rev1",
        isCorrected: true,
        approvedCorrection: { id: "corr-123", revision: 1 },
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-corrected"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    expect(result.items).toHaveLength(1);
    expect(result.items[0].rawMinutes).toBe(360); // 6.0 h = 360 min (NOT 480 min!)
    expect(result.items[0].displayHourHundredths).toBe(600);
    expect(result.items[0].amountCents).toBe(24000); // 6.0h × 40.00€ = 240.00€

    expect(result.provenance.assignments[0].effectiveHoursSource).toBe("approved_correction");
    expect(result.provenance.assignments[0].effectiveHoursVersion).toBe("v2-correction-rev1");
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Confirmed hours mismatch rejected
  // ─────────────────────────────────────────────────────────────
  it("rejects draft preparation when confirmed hours do not match the billable time window", async () => {
    // Window is 08:00–16:30 (net 450 min = 7.5 h), but effective hours claims 6.0 h without time adjustment
    const mockAssignment = {
      id: "asg-mismatch",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-bad", fullName: "Markus Berg", qualification: "pflegefachkraft" },
      order: {
        id: "ord-mismatch",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-05T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-mismatch",
        effectiveHours: 6.0, // Mismatch: 6.0h != 7.5h (450 min)
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "service_confirmation",
        effectiveVersion: "v1-sc",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-mismatch"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("EFFECTIVE_HOURS_MISMATCH");
    expect(result.diagnostics.assignmentId).toBe("asg-mismatch");
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Unresolved statutory holiday rejected
  // ─────────────────────────────────────────────────────────────
  it("rejects draft preparation when facility policy cannot resolve statutory holiday (e.g. Bavarian confessional ambiguity)", async () => {
    const mockAssignment = {
      id: "asg-bavaria-ambiguous",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-bav", fullName: "Ludwig Bauer", qualification: "pflegefachkraft" },
      order: {
        id: "ord-bav",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-08-15T00:00:00.000Z"), // Mariä Himmelfahrt
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    // Policy in Bavaria without municipality specification
    const ambiguousBavariaPolicy = createTestFrozenPolicy({
      federalState: "BY",
      municipality: null,
    });

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(ambiguousBavariaPolicy),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-bavaria-ambiguous",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-bavaria-ambiguous"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("POLICY_UNRESOLVED");
    expect(result.diagnostics.assignmentId).toBe("asg-bavaria-ambiguous");
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Unknown break position across surcharge boundary rejected
  // ─────────────────────────────────────────────────────────────
  it("rejects draft with UNRESOLVED_BREAK_ALLOCATION when break position is unknown across surcharge boundary without verified clause", async () => {
    // Evening shift 16:00–22:00 (crosses 20:00 night start) with 30m break, but no timestamps and no verified clause
    const mockAssignment = {
      id: "asg-night-break",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-night", fullName: "Lena Fischer", qualification: "pflegefachkraft" },
      order: {
        id: "ord-night",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "16:00",
        endTime: "22:00", // 6h gross - 30m break = 5.5h net
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      // No verified break clause resolver provided
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-night-break",
        effectiveHours: 5.5,
        effectiveStartTime: "16:00",
        effectiveEndTime: "22:00",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-night-break"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
    expect(result.diagnostics.assignmentId).toBe("asg-night-break");
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Missing or unverified price version rejected (PRICE_UNRESOLVED)
  // ─────────────────────────────────────────────────────────────
  it("returns PRICE_UNRESOLVED and refuses draft when no verifiable dated price version exists", async () => {
    const mockAssignment = {
      id: "asg-no-price",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-noprice", fullName: "Tim Weber", qualification: "pflegefachkraft" },
      order: {
        id: "ord-noprice",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: {
          id: "client-facility-1",
          facilityName: "Seniorenresidenz Rheinblick",
          hourlyRates: { pflegefachkraft: 45.0 }, // Live client price exists, but must NOT be used!
          paymentTermsDays: 14,
        },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(null), // No verifiable dated price version!
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-no-price",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-no-price"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.assignmentId).toBe("asg-no-price");
    expect(result.diagnostics.clientId).toBe("client-facility-1");
  });

  // ─────────────────────────────────────────────────────────────
  // 11. Fabricated contract reference for break rejected
  // ─────────────────────────────────────────────────────────────
  it("proves that a fabricated contract break clause with 100% matching values fails closed with UNRESOLVED_BREAK_ALLOCATION", async () => {
    const mockAssignment = {
      id: "asg-fab-clause",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-fab", fullName: "Klaus Klein", qualification: "pflegefachkraft" },
      order: {
        id: "ord-fab",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-03T00:00:00.000Z"),
        startTime: "16:00",
        endTime: "22:00",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    // Fabricated break clause with 100% matching fields
    const fabricatedBreakClause: VerifiedContractBreakAllocationClause = {
      clientId: "client-facility-1",
      clientContractId: "contract-1",
      policyVersion: 1,
      clauseReference: "Erfundene Klausel § 4 Abs. 2",
      rule: "proportional",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      verifiedBy: "someone",
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      verifiedBreakClauseResolver: vi.fn().mockResolvedValue(fabricatedBreakClause),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-fab-clause",
        effectiveHours: 5.5,
        effectiveStartTime: "16:00",
        effectiveEndTime: "22:00",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-fab-clause"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    // Must be rejected as UNRESOLVED_BREAK_ALLOCATION because Phase 5a strictly fails closed against synthetic in-memory clauses!
    expect(result.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Input validations: duplicate, missing, unconfirmed, already billed, mixed clients
  // ─────────────────────────────────────────────────────────────
  it("rejects duplicate assignment IDs in the request list upfront", async () => {
    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-1", "asg-2", "asg-1"] });
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("DUPLICATE_ASSIGNMENT_IDS");
  });

  it("rejects empty assignment list upfront", async () => {
    const result = await prepareV2InvoiceDraft({ assignmentIds: [] });
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("NO_ASSIGNMENTS_SELECTED");
  });

  it("rejects when an assignment ID is not found in the database", async () => {
    const mockPrisma = createMockPrisma([]); // None found
    const result = await prepareV2InvoiceDraft(
      { assignmentIds: ["non-existent-id"] },
      { prisma: mockPrisma }
    );
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("ASSIGNMENT_NOT_FOUND");
    expect(result.diagnostics.missingAssignmentIds).toEqual(["non-existent-id"]);
  });

  it("rejects when an assignment is not in confirmed status", async () => {
    const mockAssignment = {
      id: "asg-pending",
      status: "pending", // NOT confirmed
      invoiceId: null,
      worker: { id: "w-1", fullName: "Test Worker" },
      order: { clientId: "client-1" },
    };
    const mockPrisma = createMockPrisma([mockAssignment]);
    const result = await prepareV2InvoiceDraft(
      { assignmentIds: ["asg-pending"] },
      { prisma: mockPrisma }
    );
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("ASSIGNMENT_NOT_CONFIRMED");
    expect(result.diagnostics.assignmentId).toBe("asg-pending");
  });

  it("rejects when an assignment is already billed (invoiceId != null)", async () => {
    const mockAssignment = {
      id: "asg-billed",
      status: "confirmed",
      invoiceId: "inv-existing-999", // Already billed!
      worker: { id: "w-1", fullName: "Test Worker" },
      order: { clientId: "client-1" },
    };
    const mockPrisma = createMockPrisma([mockAssignment]);
    const result = await prepareV2InvoiceDraft(
      { assignmentIds: ["asg-billed"] },
      { prisma: mockPrisma }
    );
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("ALREADY_BILLED");
    expect(result.diagnostics.invoiceId).toBe("inv-existing-999");
  });

  it("rejects when assignments belong to different clients", async () => {
    const asgClientA = {
      id: "asg-client-a",
      status: "confirmed",
      invoiceId: null,
      worker: { id: "w-1", fullName: "Worker" },
      order: { clientId: "client-facility-A" },
    };
    const asgClientB = {
      id: "asg-client-b",
      status: "confirmed",
      invoiceId: null,
      worker: { id: "w-2", fullName: "Worker" },
      order: { clientId: "client-facility-B" },
    };
    const mockPrisma = createMockPrisma([asgClientA, asgClientB]);
    const result = await prepareV2InvoiceDraft(
      { assignmentIds: ["asg-client-a", "asg-client-b"] },
      { prisma: mockPrisma }
    );
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("MIXED_CLIENTS");
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Zero Database Mutation Guarantee (Strict Read-Only)
  // ─────────────────────────────────────────────────────────────
  it("guarantees 0 database mutations: never calls invoice.create, invoice.update, or assignment.update", async () => {
    const mockAssignment = {
      id: "asg-read-only-check",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-ro", fullName: "ReadOnly Tester", qualification: "pflegefachkraft" },
      order: {
        id: "ord-ro",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const mockPrisma = createMockPrisma([mockAssignment]);

    const deps: V2DraftDependencies = {
      prisma: mockPrisma,
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-read-only-check",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-read-only-check"] }, deps);
    expect(result.status).toBe("resolved");

    // Strictly verify 0 mutations
    expect(mockPrisma.invoice.create).toHaveBeenCalledTimes(0);
    expect(mockPrisma.invoice.update).toHaveBeenCalledTimes(0);
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledTimes(0);
    expect(mockPrisma.invoice.delete).toHaveBeenCalledTimes(0);
    expect(mockPrisma.assignment.update).toHaveBeenCalledTimes(0);
    expect(mockPrisma.assignment.updateMany).toHaveBeenCalledTimes(0);
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Codex Review Finding 1 Countertests: Price Record Validation
  // ─────────────────────────────────────────────────────────────
  it("rejects price record with mismatched clientId (Finding 1)", async () => {
    const mockAssignment = {
      id: "asg-price-client-mismatch",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-pcm", fullName: "Klaus Test", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pcm",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const wrongClientPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      clientId: "client-facility-999", // FOREIGN CLIENT ID!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(wrongClientPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-price-client-mismatch",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-price-client-mismatch"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.actualClientId).toBe("client-facility-999");
    expect(result.diagnostics.expectedClientId).toBe("client-facility-1");
  });

  it("rejects price record with mismatched qualification (Finding 1)", async () => {
    const mockAssignment = {
      id: "asg-price-qual-mismatch",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-pqm", fullName: "Anna Pflege", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pqm",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const wrongQualPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      qualification: "pflegehelfer", // WRONG QUALIFICATION!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(wrongQualPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-price-qual-mismatch",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-price-qual-mismatch"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.actualQualification).toBe("pflegehelfer");
    expect(result.diagnostics.expectedQualification).toBe("pflegefachkraft");
  });

  it("rejects price record with mismatched contractId (Finding 1)", async () => {
    const mockAssignment = {
      id: "asg-price-ctr-mismatch",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-A",
      worker: { id: "w-pctr", fullName: "Bernd Contract", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pctr",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const wrongContractPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      contractId: "contract-B", // MISMATCHED CONTRACT!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(wrongContractPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-price-ctr-mismatch",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-price-ctr-mismatch"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.assignmentContractId).toBe("contract-A");
    expect(result.diagnostics.priceContractId).toBe("contract-B");
  });

  it("rejects price record with null contractId for a contract-bound assignment (Codex Review 2 - Finding 1)", async () => {
    const mockAssignment = {
      id: "asg-price-ctr-null-mismatch",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1", // ASSIGNMENT IS BOUND TO CONTRACT-1!
      worker: { id: "w-pcn", fullName: "Vertragspflege Vera", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pcn",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const contractlessPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      contractId: null, // PRICE HAS NULL CONTRACT!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(contractlessPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-price-ctr-null-mismatch",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-price-ctr-null-mismatch"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.assignmentContractId).toBe("contract-1");
    expect(result.diagnostics.priceContractId).toBe(null);
  });

  it("rejects price record with invalid verification metadata (Finding 1)", async () => {
    const mockAssignment = {
      id: "asg-price-meta-invalid",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-pm", fullName: "Meta Tester", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pm",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const emptyVerifiedByPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      verifiedBy: "   ", // EMPTY VERIFIED BY!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(emptyVerifiedByPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-price-meta-invalid",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-price-meta-invalid"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
  });

  // ─────────────────────────────────────────────────────────────
  // 15. Codex Review Finding 2 Countertests: Qualification Resolution
  // ─────────────────────────────────────────────────────────────
  it("rejects shift when both order and worker qualifications are missing (Finding 2 - no default to Fachkraft)", async () => {
    const mockAssignment = {
      id: "asg-missing-qual",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-mq", fullName: "Unqualifizierte Hilfskraft", qualification: null }, // NULL QUALIFICATION!
      order: {
        id: "ord-mq",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: null, // NULL REQUIRED QUALIFICATION!
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-missing-qual",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-missing-qual"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("MISSING_QUALIFICATION");
    expect(result.diagnostics.assignmentId).toBe("asg-missing-qual");
  });

  it("rejects shift when order requiredQualification and worker qualification conflict (Finding 2)", async () => {
    const mockAssignment = {
      id: "asg-qual-conflict",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-qc", fullName: "Helfer Hans", qualification: "pflegehelfer" }, // WORKER IS HELFER
      order: {
        id: "ord-qc",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft", // ORDER DEMANDS FACHKRAFT
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-qual-conflict",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-qual-conflict"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("QUALIFICATION_CONFLICT");
    expect(result.diagnostics.requiredQualification).toBe("pflegefachkraft");
    expect(result.diagnostics.workerQualification).toBe("pflegehelfer");
  });

  // ─────────────────────────────────────────────────────────────
  // 16. Codex Review Finding 3 Countertests: Overnight Shift Price Validity
  // ─────────────────────────────────────────────────────────────
  it("rejects overnight shift when price version expires at midnight mid-shift (Finding 3)", async () => {
    // Overnight shift: 2026-03-31 23:00 to 01:00 (crosses to 2026-04-01)
    const mockAssignment = {
      id: "asg-overnight-midshift-expire",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-on", fullName: "Nachtwache Nora", qualification: "pflegefachkraft" },
      order: {
        id: "ord-on",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-31T00:00:00.000Z"),
        startTime: "23:00",
        endTime: "01:00", // Overnight! Ends on 2026-04-01
        breakMinutes: 0,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    // Price version expires on 2026-03-31 (does not cover 2026-04-01!)
    const expiringPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-03-31", // EXPIRES ON DAY 1!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(expiringPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-overnight-midshift-expire",
        effectiveHours: 2.0,
        effectiveStartTime: "23:00",
        effectiveEndTime: "01:00",
        effectiveBreakMinutes: 0,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-overnight-midshift-expire"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
    expect(result.diagnostics.failedDateIso).toBe("2026-04-01");
  });

  it("rejects price version with inverted effective dates (Finding 3)", async () => {
    const mockAssignment = {
      id: "asg-inverted-dates",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-inv", fullName: "Invert Tester", qualification: "pflegefachkraft" },
      order: {
        id: "ord-inv",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const invertedPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      effectiveFrom: "2026-05-01",
      effectiveTo: "2026-01-01", // INVERTED: effectiveFrom > effectiveTo!
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(invertedPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-inverted-dates",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-inverted-dates"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("PRICE_UNRESOLVED");
  });

  it("rejects impossible calendar dates in price effectiveFrom and effectiveTo (Codex Review 2 - Finding 2)", async () => {
    const mockAssignment = {
      id: "asg-impossible-date",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-imp", fullName: "Kalender Klaus", qualification: "pflegefachkraft" },
      order: {
        id: "ord-imp",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const impossibleTestCases = [
      { effectiveFrom: "2026-02-31", effectiveTo: null },          // Feb 31 does not exist
      { effectiveFrom: "2026-02-29", effectiveTo: null },          // 2026 is non-leap year
      { effectiveFrom: "2026-04-31", effectiveTo: null },          // April 31 does not exist
      { effectiveFrom: "2026-01-01", effectiveTo: "2026-02-31" },  // Impossible effectiveTo
      { effectiveFrom: "2026-11-31", effectiveTo: null },          // Nov 31 does not exist
      { effectiveFrom: "2026-06-31", effectiveTo: null },          // June 31 does not exist
    ];

    for (const tc of impossibleTestCases) {
      const badPrice: PriceVersionRecord = {
        ...STANDARD_PRICE_VERSION,
        effectiveFrom: tc.effectiveFrom,
        effectiveTo: tc.effectiveTo,
      };

      const deps: V2DraftDependencies = {
        prisma: createMockPrisma([mockAssignment]),
        priceVersionResolver: vi.fn().mockResolvedValue(badPrice),
        facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
        effectiveHoursResolver: vi.fn().mockResolvedValue({
          assignmentId: "asg-impossible-date",
          effectiveHours: 8.0,
          effectiveStartTime: "08:00",
          effectiveEndTime: "16:30",
          effectiveBreakMinutes: 30,
          source: "scheduled",
          effectiveVersion: "v1",
          isCorrected: false,
        }),
      };

      const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-impossible-date"] }, deps);
      expect(result.status).toBe("unresolved");
      if (result.status !== "unresolved") continue;

      expect(result.code).toBe("PRICE_UNRESOLVED");
    }
  });

  it("accepts valid leap year February 29th in price validity (Codex Review 2 - Finding 2)", async () => {
    const mockAssignment = {
      id: "asg-leap-date",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-leap", fullName: "Schaltjahr Sepp", qualification: "pflegefachkraft" },
      order: {
        id: "ord-leap",
        clientId: "client-facility-1",
        shiftDate: new Date("2024-02-29T00:00:00.000Z"), // Leap year shift!
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const leapPrice: PriceVersionRecord = {
      ...STANDARD_PRICE_VERSION,
      effectiveFrom: "2024-02-29", // Valid leap day!
      effectiveTo: "2024-02-29",
    };

    const leapPolicy = createTestFrozenPolicy({
      effectiveFrom: "2024-01-01",
    });

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(leapPrice),
      facilityPolicyResolver: vi.fn().mockResolvedValue(leapPolicy),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-leap-date",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-leap-date"] }, deps);
    expect(result.status).toBe("resolved");
  });

  // ─────────────────────────────────────────────────────────────
  // 17. Codex Review Finding 6 Countertests: Policy Overlap Ambiguity
  // ─────────────────────────────────────────────────────────────
  it("rejects preparation when multiple frozen policies overlap on the same shift date (Finding 6)", async () => {
    const mockAssignment = {
      id: "asg-policy-overlap",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-po", fullName: "Overlap Tester", qualification: "pflegefachkraft" },
      order: {
        id: "ord-po",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-02T00:00:00.000Z"),
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const mockPrisma = {
      ...createMockPrisma([mockAssignment]),
      facilitySurchargePolicy: {
        findMany: vi.fn().mockResolvedValue([
          { id: "pol-1", policyVersion: 1, isFrozen: true, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
          { id: "pol-2", policyVersion: 2, isFrozen: true, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        ]),
      },
    };

    const deps: V2DraftDependencies = {
      prisma: mockPrisma,
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      // No facilityPolicyResolver override, forces database lookup
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-policy-overlap",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-policy-overlap"] }, deps);
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;

    expect(result.code).toBe("AMBIGUOUS_POLICY_OVERLAP");
    expect(result.diagnostics.matchingPolicyIds).toEqual(["pol-1", "pol-2"]);
  });

  // ─────────────────────────────────────────────────────────────
  // 18. Codex Review Finding 5 Tests: Snapshot vs PDF Parity
  // ─────────────────────────────────────────────────────────────
  it("guarantees 100% mathematical and formatting parity between calculatedLineItems and pdfItems (Finding 5)", async () => {
    const mockAssignment = {
      id: "asg-pdf-parity",
      status: "confirmed",
      invoiceId: null,
      contractId: "contract-1",
      worker: { id: "w-pdf", fullName: "Parity Tester", qualification: "pflegefachkraft" },
      order: {
        id: "ord-pdf",
        clientId: "client-facility-1",
        shiftDate: new Date("2026-03-07T00:00:00.000Z"), // Saturday
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        requiredQualification: "pflegefachkraft",
        client: { id: "client-facility-1", facilityName: "Seniorenresidenz Rheinblick", paymentTermsDays: 14 },
      },
    };

    const deps: V2DraftDependencies = {
      prisma: createMockPrisma([mockAssignment]),
      priceVersionResolver: vi.fn().mockResolvedValue(STANDARD_PRICE_VERSION),
      facilityPolicyResolver: vi.fn().mockResolvedValue(FROZEN_NRW_POLICY),
      effectiveHoursResolver: vi.fn().mockResolvedValue({
        assignmentId: "asg-pdf-parity",
        effectiveHours: 8.0,
        effectiveStartTime: "08:00",
        effectiveEndTime: "16:30",
        effectiveBreakMinutes: 30,
        source: "scheduled",
        effectiveVersion: "v1",
        isCorrected: false,
      }),
    };

    const result = await prepareV2InvoiceDraft({ assignmentIds: ["asg-pdf-parity"] }, deps);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;

    const { items, pdfItems, snapshotData, totals } = result;

    // Must be present in both top-level and snapshotData
    expect(pdfItems).toBeDefined();
    expect(snapshotData.pdfItems).toEqual(pdfItems);
    expect(pdfItems).toHaveLength(items.length);

    // Verify 100% item-by-item contract parity
    for (let i = 0; i < items.length; i++) {
      const line = items[i];
      const pdf = pdfItems[i];

      expect(pdf.pos).toBe(line.pos);
      expect(pdf.description).toBe(line.description);
      expect(pdf.hours).toBe(line.hoursDisplay); // e.g. "8,00"

      // rate in pdf must NOT contain "€" symbol (to avoid "€ €" double-suffix in PDF renderer)
      expect(pdf.rate).not.toContain("€");
      expect(pdf.rate).toBe(line.rateDisplay.replace(" €", ""));

      // amount in pdf must match line.amountDisplay
      expect(pdf.amount).toBe(line.amountDisplay);
    }

    // Verify mathematical subtotal sum
    const subtotalFromPdf = pdfItems.reduce((acc, p) => {
      const clean = p.amount.replace(" €", "").replace(/\./g, "").replace(",", ".");
      return acc + Math.round(parseFloat(clean) * 100);
    }, 0);

    expect(subtotalFromPdf).toBe(totals.subtotalCents);
  });
});
