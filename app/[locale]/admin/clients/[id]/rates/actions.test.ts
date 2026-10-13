/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockAuditLogCreate = vi.fn().mockResolvedValue({ id: "audit-1" });
const mockPolicyCreate = vi.fn().mockResolvedValue({ id: "policy-1", policyVersion: 1, frozenHash: "hash-pol" });
const mockRateCreate = vi.fn().mockResolvedValue({ id: "rate-1", rateVersion: 1, frozenHash: "hash-rate" });
const mockClientUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockClientFindUniqueOrThrow = vi.fn().mockResolvedValue({ updatedAt: new Date("2026-10-13T12:00:00.000Z") });

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "admin-actor-1",
    email: "admin@rheinahr.de",
    role: "admin",
    active: true,
  }),
  roleSatisfies: vi.fn((role: string, allowed: string[]) => allowed.includes(role)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "admin-actor-1",
        email: "admin@rheinahr.de",
        fullName: "Admin Officer",
        role: "admin",
        active: true,
      }),
    },
    client: {
      findUnique: vi.fn().mockResolvedValue({
        id: "client-1",
        facilityName: "Residenz Alpha",
        frameworkAgreementSignedAt: new Date("2026-01-01"),
        frameworkAgreementUrl: "https://storage/fw.pdf",
        hourlyRates: { pflegefachkraft: 54.90, pflegehelfer: 36.90 },
        surchargeSat: 0.25,
        surchargeSun: 0.50,
        surchargeHoliday: 1.00,
        surchargeNight: 0.25,
        nightStart: "20:00",
        nightEnd: "06:00",
      }),
    },
    clientContract: {
      findUnique: vi.fn().mockResolvedValue({
        id: "contract-1",
        clientId: "client-1",
        period: "2026",
        status: "signed",
        signedAt: new Date("2026-01-01"),
        documentUrl: "https://storage/contract.pdf",
      }),
    },
    facilitySurchargePolicy: {
      findMany: vi.fn().mockResolvedValue([]),
      create: (...args: any[]) => mockPolicyCreate(...args),
    },
    clientHourlyRateVersion: {
      findMany: vi.fn().mockResolvedValue([]),
      create: (...args: any[]) => mockRateCreate(...args),
    },
    auditLog: {
      create: (...args: any[]) => mockAuditLogCreate(...args),
    },
    $transaction: vi.fn(async (callback: any) => {
      const tx = {
        client: {
          updateMany: mockClientUpdateMany,
          findUniqueOrThrow: mockClientFindUniqueOrThrow,
        },
        facilitySurchargePolicy: {
          create: mockPolicyCreate,
        },
        clientHourlyRateVersion: {
          create: mockRateCreate,
        },
        auditLog: {
          create: mockAuditLogCreate,
        },
      };
      return callback(tx);
    }),
  },
}));

import {
  previewClientApprovalAction,
  commitClientApprovalAction,
  saveClientPricingDraftAction,
  type ApprovalPreviewInput,
} from "./actions";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

describe("Rates and Surcharges Approval Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientUpdateMany.mockResolvedValue({ count: 1 });
  });

  const pricingInput = {
    clientId: "11111111-1111-4111-8111-111111111111",
    expectedUpdatedAt: "2026-10-13T10:00:00.000Z",
    surchargeSatPct: 25,
    surchargeSunPct: 100,
    surchargeHolidayPct: 125,
    surchargeNightPct: 50,
    nightStart: "20:00",
    nightEnd: "06:00",
    hourlyRates: {
      pflegefachkraft: 54.9,
      pflegehelfer: 34,
      betreuungskraft: null,
      pflegedienstleitung: null,
      kuechenhilfe: null,
      hausmeister: null,
    },
  };

  it("saves editable remuneration and surcharges without touching frozen versions", async () => {
    const result = await saveClientPricingDraftAction(pricingInput);
    expect(result.ok).toBe(true);
    expect(mockClientUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: pricingInput.clientId, updatedAt: new Date(pricingInput.expectedUpdatedAt) },
      data: expect.objectContaining({
        surchargeSat: 0.25,
        surchargeSun: 1,
        hourlyRates: { pflegefachkraft: 54.9, pflegehelfer: 34 },
      }),
    }));
    expect(mockPolicyCreate).not.toHaveBeenCalled();
    expect(mockRateCreate).not.toHaveBeenCalled();
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "client.pricing_draft.updated" }),
    }));
  });

  it("rejects a stale edit before creating an audit record", async () => {
    mockClientUpdateMany.mockResolvedValueOnce({ count: 0 });
    const result = await saveClientPricingDraftAction(pricingInput);
    expect(result.ok).toBe(false);
    expect(mockAuditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid pricing before any database write", async () => {
    const result = await saveClientPricingDraftAction({ ...pricingInput, surchargeSatPct: 500 });
    expect(result.ok).toBe(false);
    expect(mockClientUpdateMany).not.toHaveBeenCalled();
  });

  const baseInput: ApprovalPreviewInput = {
    clientId: "client-1",
    clientContractId: "contract-1",
    sourceType: "contract",
    sourceReference: "Rahmenvertrag 2026 §5 Abs. 2",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    approveSurcharges: true,
    federalState: "NW",
    municipality: "Bonn",
    districtLocality: null,
    nightStart: "20:00",
    nightEnd: "06:00",
    combinationRule: "highest_non_night_plus_night",
    surchargeSat: 0.25,
    surchargeSun: 0.50,
    surchargeHoliday: 1.00,
    surchargeNight: 0.25,
    approveRates: true,
    selectedRates: [
      { qualification: "pflegefachkraft", hourlyRateEur: 54.90 },
      { qualification: "pflegehelfer", hourlyRateEur: 36.90 },
    ],
  };

  it("rejects unauthorized user", async () => {
    (getCurrentUser as any).mockResolvedValueOnce(null);
    const result = await previewClientApprovalAction(baseInput);
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("forbidden");
  });

  it("rejects when no selection is made (no rates and no surcharges)", async () => {
    const result = await previewClientApprovalAction({
      ...baseInput,
      approveSurcharges: false,
      approveRates: false,
    });
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("noApprovalSelection");
  });

  it("rejects missing surcharge rates or fields when approveSurcharges is true", async () => {
    const result = await previewClientApprovalAction({
      ...baseInput,
      surchargeSat: undefined,
    });
    expect(result.ok).toBe(false);
    expect((result as any).error).toBe("missingSurchargeRates");
  });

  it("rejects rate <= 0", async () => {
    const result = await previewClientApprovalAction({
      ...baseInput,
      selectedRates: [{ qualification: "pflegefachkraft", hourlyRateEur: 0 }],
    });
    expect(result.ok).toBe(false);
    expect((result as any).error).toContain("größer als 0");
  });

  it("previews valid approval successfully with canonical hashes", async () => {
    const result = await previewClientApprovalAction(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.surchargePreview).not.toBeNull();
    expect(result.data.surchargePreview?.integrity.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.ratePreviews.length).toBe(2);
    expect(result.data.ratePreviews[0].integrity.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts an explicitly confirmed 0% profile setting without claiming a contract document", async () => {
    const clientWithoutDocument = {
      id: "client-1",
      facilityName: "Residenz Alpha",
      frameworkAgreementSignedAt: null,
      frameworkAgreementUrl: null,
      hourlyRates: { pflegefachkraft: 54.90, pflegehelfer: 36.90 },
      surchargeSat: 0,
      surchargeSun: 0.50,
      surchargeHoliday: 1.00,
      surchargeNight: 0.25,
      nightStart: "20:00",
      nightEnd: "06:00",
    };
    (prisma.client.findUnique as any)
      .mockResolvedValueOnce(clientWithoutDocument)
      .mockResolvedValueOnce(clientWithoutDocument)
      .mockResolvedValueOnce(clientWithoutDocument);
    const result = await previewClientApprovalAction({
      ...baseInput,
      clientContractId: null,
      sourceType: "setting",
      sourceReference: "",
      surchargeSat: 0,
      zeroRateRationale: {},
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.surchargePreview?.provenance.sourceType).toBe("setting");
    expect(result.data.surchargePreview?.provenance.sourceDocumentUrl).toBeNull();
    expect(result.data.surchargePreview?.terms.surchargeSat).toBe(0);
    expect(result.data.ratePreviews).toHaveLength(2);
    expect(result.data.ratePreviews[0].provenance.sourceType).toBe("setting");
  });

  it("rejects an altered profile setting before approval", async () => {
    const result = await previewClientApprovalAction({
      ...baseInput,
      clientContractId: null,
      sourceType: "setting",
      sourceReference: "",
      surchargeSat: 0.99,
    });
    expect(result.ok).toBe(false);
    expect((result as any).error).toContain("Zuschläge fehlen");
    expect(mockPolicyCreate).not.toHaveBeenCalled();
  });

  it("audits profile confirmation as a setting without claiming a contract", async () => {
    const settingInput: ApprovalPreviewInput = {
      ...baseInput,
      clientContractId: null,
      sourceType: "setting",
      sourceReference: "",
    };
    const preview = await previewClientApprovalAction(settingInput);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const result = await commitClientApprovalAction({
      ...settingInput,
      expectedSurchargeHash: preview.data.surchargePreview?.integrity.canonicalHash,
      expectedRateHashes: Object.fromEntries(preview.data.ratePreviews.map((rate) => [
        rate.rateTerms.qualification, rate.integrity.canonicalHash,
      ])),
    });
    expect(result.ok).toBe(true);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          sourceType: "setting",
          sourceReference: "Vergütungsseite: administrativ bestätigte Vergütung und Zuschläge",
          contractReference: null,
        }),
      }),
    }));
  });

  it("rejects commit when expected hashes mismatch (anti-tampering check)", async () => {
    const preview = await previewClientApprovalAction(baseInput);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const commitResult = await commitClientApprovalAction({
      ...baseInput,
      expectedSurchargeHash: "tampered-hash",
      expectedRateHashes: {
        pflegefachkraft: preview.data.ratePreviews[0].integrity.canonicalHash,
        pflegehelfer: preview.data.ratePreviews[1].integrity.canonicalHash,
      },
    });

    expect(commitResult.ok).toBe(false);
    expect((commitResult as any).error).toContain("Sicherheitsprüfung fehlgeschlagen");
  });

  it("commits and freezes rates and surcharge policy with audit log", async () => {
    const preview = await previewClientApprovalAction(baseInput);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const commitResult = await commitClientApprovalAction({
      ...baseInput,
      expectedSurchargeHash: preview.data.surchargePreview!.integrity.canonicalHash,
      expectedRateHashes: {
        pflegefachkraft: preview.data.ratePreviews[0].integrity.canonicalHash,
        pflegehelfer: preview.data.ratePreviews[1].integrity.canonicalHash,
      },
    });

    expect(commitResult.ok).toBe(true);
    expect(mockPolicyCreate).toHaveBeenCalled();
    expect(mockRateCreate).toHaveBeenCalledTimes(2);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "client.rates_and_surcharges.approved",
          entity: "Client",
          entityId: "client-1",
        }),
      })
    );
  });
});
