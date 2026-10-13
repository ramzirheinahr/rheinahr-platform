/**
 * Unit and Verification Tests for ClientPriceResolver (Phase 5b-1)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolveClientPriceVersion,
  computeRateVersionCanonicalHash,
} from "./client-price-resolver";

describe("ClientPriceResolver (Phase 5b-1)", () => {
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
