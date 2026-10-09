/**
 * Invoice Calculation Version Helper
 * 
 * Defines and resolves the calculation engine version used for an invoice.
 * Phase 1 rules:
 * - Absence of snapshot entirely (null or undefined): resolved as 'legacy-v1' (isExplicit: false).
 * - Valid record without calculationVersion or with calculationVersion === undefined: resolved as 'legacy-v1' (isExplicit: false).
 * - Explicit 'legacy-v1': resolved as 'legacy-v1' (isExplicit: true).
 * - Explicit 'v2': resolved as 'v2' (reserved, isExplicit: true, isLegacy: false).
 * - Explicit null, "", whitespace-only, unknown strings, or invalid types for calculationVersion: status 'unsupported' (isLegacy: false).
 * - Non-null snapshot of invalid structure (primitives, arrays): status 'unsupported' (isLegacy: false).
 * - In all 'unsupported' cases, both isLegacy and isV2 return false.
 * - Calculation version is NEVER inferred from invoice dates, amounts, status, or emailSent flags.
 */

export type InvoiceCalculationVersion = "legacy-v1" | "v2";

export const CALCULATION_VERSIONS = {
  LEGACY_V1: "legacy-v1",
  V2: "v2",
} as const;

export type CalculationVersionResolution =
  | {
      status: "resolved";
      version: "legacy-v1";
      isLegacy: true;
      isExplicit: boolean;
    }
  | {
      status: "resolved";
      version: "v2";
      isLegacy: false;
      isExplicit: true;
    }
  | {
      status: "unsupported";
      rawVersion: unknown;
      isLegacy: false;
    };

/**
 * Resolves the calculation version of an invoice from its snapshot data.
 */
export function resolveInvoiceCalculationVersion(
  snapshotData: unknown
): CalculationVersionResolution {
  // 1. Complete absence of snapshot entirely (null or undefined)
  if (snapshotData === null || snapshotData === undefined) {
    return {
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    };
  }

  // 2. Non-null snapshot of invalid structure (primitives: string, number, boolean; or array)
  if (typeof snapshotData !== "object" || Array.isArray(snapshotData)) {
    return {
      status: "unsupported",
      rawVersion: snapshotData,
      isLegacy: false,
    };
  }

  // 3. Valid record object
  const record = snapshotData as Record<string, unknown>;
  const raw = record.calculationVersion;

  // Tag is absent from the record
  if (raw === undefined) {
    return {
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: false,
    };
  }

  // Explicit legacy-v1
  if (raw === CALCULATION_VERSIONS.LEGACY_V1) {
    return {
      status: "resolved",
      version: "legacy-v1",
      isLegacy: true,
      isExplicit: true,
    };
  }

  // Explicit reserved v2
  if (raw === CALCULATION_VERSIONS.V2) {
    return {
      status: "resolved",
      version: "v2",
      isLegacy: false,
      isExplicit: true,
    };
  }

  // Null, empty string, whitespace-only, numbers, objects, arrays, or unknown strings
  return {
    status: "unsupported",
    rawVersion: raw,
    isLegacy: false,
  };
}

/**
 * Returns true if the invoice calculation version resolves to legacy-v1.
 */
export function isLegacyCalculationVersion(snapshotData: unknown): boolean {
  const resolution = resolveInvoiceCalculationVersion(snapshotData);
  return resolution.status === "resolved" && resolution.isLegacy;
}

/**
 * Returns true if the invoice explicitly targets v2.
 */
export function isV2CalculationVersion(snapshotData: unknown): boolean {
  const resolution = resolveInvoiceCalculationVersion(snapshotData);
  return resolution.status === "resolved" && resolution.version === "v2";
}
