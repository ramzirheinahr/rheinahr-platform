import { describe, expect, it } from "vitest";
import {
  CALCULATION_VERSIONS,
  isLegacyCalculationVersion,
  isV2CalculationVersion,
  resolveInvoiceCalculationVersion,
} from "./invoice-calculation-version";

describe("invoice-calculation-version helper", () => {
  it("classifies complete absence of snapshot (null or undefined) as legacy-v1 without explicit tag", () => {
    expect(resolveInvoiceCalculationVersion(null)).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });

    expect(resolveInvoiceCalculationVersion(undefined)).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });

    expect(isLegacyCalculationVersion(null)).toBe(true);
    expect(isLegacyCalculationVersion(undefined)).toBe(true);
    expect(isV2CalculationVersion(null)).toBe(false);
    expect(isV2CalculationVersion(undefined)).toBe(false);
  });

  it("classifies valid record without calculationVersion or with calculationVersion === undefined as legacy-v1 without explicit tag", () => {
    expect(resolveInvoiceCalculationVersion({})).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });

    expect(resolveInvoiceCalculationVersion({ items: [] })).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });

    expect(resolveInvoiceCalculationVersion({ calculationVersion: undefined })).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });

    expect(isLegacyCalculationVersion({})).toBe(true);
    expect(isLegacyCalculationVersion({ calculationVersion: undefined })).toBe(true);
    expect(isV2CalculationVersion({})).toBe(false);
    expect(isV2CalculationVersion({ calculationVersion: undefined })).toBe(false);
  });

  it("recognizes explicit legacy-v1 tag", () => {
    const res = resolveInvoiceCalculationVersion({
      calculationVersion: CALCULATION_VERSIONS.LEGACY_V1,
    });

    expect(res).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: true,
    });
    expect(isLegacyCalculationVersion({ calculationVersion: "legacy-v1" })).toBe(true);
    expect(isV2CalculationVersion({ calculationVersion: "legacy-v1" })).toBe(false);
  });

  it("recognizes explicit v2 tag as reserved without activating calculation", () => {
    const res = resolveInvoiceCalculationVersion({
      calculationVersion: CALCULATION_VERSIONS.V2,
    });

    expect(res).toEqual({
      status: "resolved",
      version: "v2",
      isLegacy: false,
      isExplicit: true,
    });
    expect(isLegacyCalculationVersion({ calculationVersion: "v2" })).toBe(false);
    expect(isV2CalculationVersion({ calculationVersion: "v2" })).toBe(true);
  });

  it("classifies explicit null, empty string, whitespace-only, or unknown tags as unsupported", () => {
    const corruptTagCases = [
      null,
      "",
      "   ",
      "\t",
      "v3",
      "v1",
      "legacy",
      123,
      true,
      false,
      { nested: "version" },
      ["legacy-v1"],
    ];

    for (const tag of corruptTagCases) {
      const res = resolveInvoiceCalculationVersion({ calculationVersion: tag });
      expect(res).toEqual({
        status: "unsupported",
        rawVersion: tag,
        isLegacy: false,
      });
      expect(isLegacyCalculationVersion({ calculationVersion: tag })).toBe(false);
      expect(isV2CalculationVersion({ calculationVersion: tag })).toBe(false);
    }
  });

  it("classifies non-null snapshot of invalid structure (primitives, arrays) as unsupported", () => {
    const invalidStructures = [
      "broken-json-string",
      12345,
      true,
      false,
      [],
      ["item1"],
      [{ calculationVersion: "legacy-v1" }],
    ];

    for (const invalid of invalidStructures) {
      const res = resolveInvoiceCalculationVersion(invalid);
      expect(res).toEqual({
        status: "unsupported",
        rawVersion: invalid,
        isLegacy: false,
      });
      expect(isLegacyCalculationVersion(invalid)).toBe(false);
      expect(isV2CalculationVersion(invalid)).toBe(false);
    }
  });

  it("never infers calculation version from invoice dates, amounts, status, or emailSent", () => {
    const historicalSnapshotWithIndicators = {
      date: "2026-10-08",
      netAmount: 1500,
      status: "paid",
      emailSent: { sentAt: "2026-10-08T10:00:00Z" },
    };

    const res = resolveInvoiceCalculationVersion(historicalSnapshotWithIndicators);
    expect(res).toEqual({
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    });
    expect(isLegacyCalculationVersion(historicalSnapshotWithIndicators)).toBe(true);
    expect(isV2CalculationVersion(historicalSnapshotWithIndicators)).toBe(false);
  });
});
