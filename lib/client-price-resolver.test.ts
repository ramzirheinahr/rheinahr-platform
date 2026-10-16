/**
 * Unit and Verification Tests for ClientPriceResolver (Phase 5b-1)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 */

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { hashClientPricingRateChange, CLIENT_RATE_CHANGE_SOURCE } from "./client-pricing-rate-change";
import {
  resolveClientPriceVersion,
  computeRateVersionCanonicalHash,
} from "./client-price-resolver";

describe("ClientPriceResolver (Phase 5b-1)", () => {
  function defaultRate(effectiveFrom = "2026-10-15", cents = 3990) {
    const terms = {
      qualificationCode: "new_specialty", version: 1, hourlyRateInCents: cents,
      effectiveFrom, sourceReference: "System settings", verifiedByUserId: "admin-1",
    };
    return {
      ...terms, id: "default-version-1", effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      frozenHash: createHash("sha256").update(JSON.stringify(terms)).digest("hex"),
      verifiedAt: new Date("2026-10-15T09:00:00.000Z"),
    };
  }

  function clientChange(cents: number | null, effectiveFrom = "2026-10-16") {
    const terms = {
      clientId: "client-test-1", qualificationCode: "new_specialty",
      hourlyRateInCents: cents, effectiveFrom,
      verifiedByUserId: "admin-1", sourceReference: CLIENT_RATE_CHANGE_SOURCE,
    };
    return {
      ...terms, id: `client-change-${cents}`, frozenHash: hashClientPricingRateChange(terms),
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      createdAt: new Date(`${effectiveFrom}T09:00:00.000Z`),
    };
  }

  it("uses a dated client override, then restores the dated default after a blank override", async () => {
    const rates = [defaultRate()];
    const changes = [clientChange(4200), clientChange(null, "2026-10-18")];
    const common = {
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([]) } },
      clientId: "client-test-1", qualification: "new_specialty",
      preloadedDefaultRates: rates, preloadedRateChanges: changes,
    };
    const before = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-15" });
    const override = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-17" });
    const restored = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-18" });
    expect(before.status === "resolved" && before.priceRecord.hourlyRateInCents).toBe(3990);
    expect(override.status === "resolved" && override.priceRecord.hourlyRateInCents).toBe(4200);
    expect(restored.status === "resolved" && restored.priceRecord.hourlyRateInCents).toBe(3990);
  });

  it("rejects a tampered client override and a midnight rate change", async () => {
    const common = {
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([]) } },
      clientId: "client-test-1", qualification: "new_specialty",
      preloadedDefaultRates: [defaultRate()],
    };
    const tampered = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-16",
      preloadedRateChanges: [{ ...clientChange(4200), hourlyRateInCents: 1 }] });
    const overnight = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-16",
      spansIntoNextDay: true, endShiftDateIso: "2026-10-17",
      preloadedRateChanges: [clientChange(4200), clientChange(4300, "2026-10-17")] });
    expect(tampered.status).toBe("unresolved");
    expect(overnight.status).toBe("unresolved");
  });

  it("keeps an existing contract-specific frozen rate ahead of a client-wide edit", async () => {
    const contract = createValidDbRate({
      clientContractId: "contract-1", qualification: "pflegefachkraft",
    });
    contract.frozenHash = computeRateVersionCanonicalHash({
      clientId: contract.clientId, clientContractId: contract.clientContractId,
      rateVersion: contract.rateVersion, qualification: contract.qualification,
      hourlyRateInCents: contract.hourlyRateInCents, effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31", sourceType: contract.sourceType,
      sourceReference: contract.sourceReference,
    });
    const result = await resolveClientPriceVersion({
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([contract]) } },
      clientId: "client-test-1", qualification: "pflegefachkraft",
      shiftDateIso: "2026-10-16", contractId: "contract-1",
      preloadedRateChanges: [{ ...clientChange(4200), qualificationCode: "pflegefachkraft" }],
    });
    expect(result.status === "resolved" && result.priceRecord.hourlyRateInCents).toBe(4500);
  });

  it("lets a later client edit supersede an old general frozen rate only from the edit date", async () => {
    const oldRate = createValidDbRate({ qualification: "new_specialty" });
    oldRate.frozenHash = computeRateVersionCanonicalHash({
      clientId: oldRate.clientId, clientContractId: null, rateVersion: oldRate.rateVersion,
      qualification: oldRate.qualification, hourlyRateInCents: oldRate.hourlyRateInCents,
      effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
      sourceType: oldRate.sourceType, sourceReference: oldRate.sourceReference,
    });
    const common = {
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([oldRate]) } },
      clientId: "client-test-1", qualification: "new_specialty",
      preloadedRateChanges: [clientChange(4200)],
    };
    const before = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-15" });
    const after = await resolveClientPriceVersion({ ...common, shiftDateIso: "2026-10-16" });
    expect(before.status === "resolved" && before.priceRecord.hourlyRateInCents).toBe(4500);
    expect(after.status === "resolved" && after.priceRecord.hourlyRateInCents).toBe(4200);
  });

  it("uses a dated verified catalog rate only when no client rate covers the shift", async () => {
    const result = await resolveClientPriceVersion({
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([]) } },
      clientId: "client-test-1", qualification: "new_specialty", shiftDateIso: "2026-10-16",
      preloadedDefaultRates: [defaultRate()],
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.priceRecord.hourlyRateInCents).toBe(3990);
  });

  it("does not apply a catalog price before its effective date or if its hash is wrong", async () => {
    const params = {
      prisma: { clientHourlyRateVersion: { findMany: vi.fn().mockResolvedValue([]) } },
      clientId: "client-test-1", qualification: "new_specialty", preloadedDefaultRates: [defaultRate()],
    };
    const before = await resolveClientPriceVersion({ ...params, shiftDateIso: "2026-10-14" });
    const tampered = await resolveClientPriceVersion({
      ...params, shiftDateIso: "2026-10-16",
      preloadedDefaultRates: [{ ...defaultRate(), hourlyRateInCents: 1 }],
    });
    expect(before.status).toBe("unresolved");
    expect(tampered.status).toBe("unresolved");
  });
  const mockUser = {
    id: "user-auditor-1",
    fullName: "Stefan Auditor",
    email: "auditor@rheinahr.de",
  };

  function createValidDbRate(overrides?: Record<string, unknown>) {
    const base = {
      id: "rate-ver-101",
      clientId: "client-test-1",
      clientContractId: null,
      rateVersion: 1,
      qualification: "pflegefachkraft",
      hourlyRateInCents: 4500,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
      sourceType: "contract",
      sourceReference: "Rahmenvertrag 2026 § 4 Abs. 1",
      isFrozen: true,
      frozenAt: new Date("2026-01-01T00:00:00.000Z"),
      frozenHash: "",
      verifiedByUserId: mockUser.id,
      verifiedAt: new Date("2026-01-01T12:00:00.000Z"),
      verifiedByUser: mockUser,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    };

    if (!overrides?.frozenHash) {
      base.frozenHash = computeRateVersionCanonicalHash({
        clientId: base.clientId,
        clientContractId: base.clientContractId,
        rateVersion: base.rateVersion,
        qualification: base.qualification,
        hourlyRateInCents: base.hourlyRateInCents,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        sourceType: base.sourceType,
        sourceReference: base.sourceReference,
      });
    }

    return base;
  }

  it("resolves valid frozen dated price version from database", async () => {
    const dbRate = createValidDbRate();
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([dbRate]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.priceRecord.priceVersionId).toBe("rate-ver-101");
      expect(result.priceRecord.hourlyRateInCents).toBe(4500);
      expect(result.priceRecord.effectiveFrom).toBe("2026-01-01");
      expect(result.priceRecord.effectiveTo).toBe("2026-12-31");
      expect(result.priceRecord.verifiedBy).toBe("Stefan Auditor");
    }
  });

  it("uses an approved client-wide setting for a contract shift when no contract price exists", async () => {
    const setting = createValidDbRate({ sourceType: "setting", sourceReference: "Kundenprofil: administrativ bestätigt" });
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([setting]);
    const result = await resolveClientPriceVersion({
      prisma: { clientHourlyRateVersion: { findMany } },
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
      contractId: "contract-1",
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.priceRecord.contractId).toBeNull();
      expect(result.priceRecord.sourceType).toBe("setting");
    }
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0].where.sourceType).toBe("setting");
  });

  it("prefers the contract price over a client-wide setting", async () => {
    const contractRate = createValidDbRate({ clientContractId: "contract-1" });
    const findMany = vi.fn().mockResolvedValue([contractRate]);
    const result = await resolveClientPriceVersion({
      prisma: { clientHourlyRateVersion: { findMany } },
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
      contractId: "contract-1",
    });
    expect(result.status).toBe("resolved");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("does not use an unverified general contract rate as a client-wide setting", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await resolveClientPriceVersion({
      prisma: { clientHourlyRateVersion: { findMany } },
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
      contractId: "contract-1",
    });
    expect(result.status).toBe("unresolved");
    expect(findMany.mock.calls[1][0].where.sourceType).toBe("setting");
  });

  it("fails with PRICE_UNRESOLVED when no matching price is found in database", async () => {
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("PRICE_UNRESOLVED");
      expect(result.message).toContain("Keine gültige, datierte Preisversion");
    }
  });

  it("fails with AMBIGUOUS_PRICE_OVERLAP when multiple active prices overlap on shift date", async () => {
    const rateA = createValidDbRate({ id: "rate-ver-101", hourlyRateInCents: 4500 });
    const rateB = createValidDbRate({ id: "rate-ver-102", hourlyRateInCents: 4800 });
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([rateA, rateB]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("AMBIGUOUS_PRICE_OVERLAP");
      expect(result.message).toContain("Mehrdeutige Preisversionen");
    }
  });

  it("fails with PRICE_NOT_FROZEN when matching price record is not frozen", async () => {
    const unfrozenRate = createValidDbRate({ isFrozen: false });
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([unfrozenRate]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("PRICE_NOT_FROZEN");
    }
  });

  it("fails with PRICE_UNRESOLVED when frozenHash does not match (tampering detected)", async () => {
    const tamperedRate = createValidDbRate({ frozenHash: "faked_or_tampered_hash_123456" });
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([tamperedRate]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("PRICE_UNRESOLVED");
      expect(result.message).toContain("Integritätsverletzung");
    }
  });

  it("strictly enforces contract scoping: contract-bound shift cannot resolve general rate", async () => {
    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockImplementation((args: { where: { clientContractId?: string | null } }) => {
          // If contractId is scoped to contract-99, general rate with null contractId won't match
          if (args.where.clientContractId === "contract-99") {
            return Promise.resolve([]);
          }
          return Promise.resolve([createValidDbRate()]);
        }),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
      contractId: "contract-99",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("PRICE_UNRESOLVED");
      expect(result.message).toContain('Vertrag "contract-99"');
    }
  });

  it("verifies overnight rollover when shift spans into next day (23:00 to 00:01)", async () => {
    // Price expires on 2026-05-15
    const expiringRate = createValidDbRate({
      effectiveTo: new Date("2026-05-15T00:00:00.000Z"),
    });
    expiringRate.frozenHash = computeRateVersionCanonicalHash({
      clientId: expiringRate.clientId,
      clientContractId: expiringRate.clientContractId,
      rateVersion: expiringRate.rateVersion,
      qualification: expiringRate.qualification,
      hourlyRateInCents: expiringRate.hourlyRateInCents,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-05-15",
      sourceType: expiringRate.sourceType,
      sourceReference: expiringRate.sourceReference,
    });

    const mockPrisma = {
      clientHourlyRateVersion: {
        findMany: vi.fn().mockResolvedValue([expiringRate]),
      },
    };

    const result = await resolveClientPriceVersion({
      prisma: mockPrisma,
      clientId: "client-test-1",
      qualification: "pflegefachkraft",
      shiftDateIso: "2026-05-15",
      spansIntoNextDay: true,
      endShiftDateIso: "2026-05-16",
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.code).toBe("PRICE_UNRESOLVED");
      expect(result.message).toContain("läuft während der Nachtschicht ab");
    }
  });
});
