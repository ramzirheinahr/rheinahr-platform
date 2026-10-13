/**
 * Phase 07e: Facility Surcharge Policy Intake Decision Template & Validator
 *
 * Implements Management & Accounting Decision (docs/audit/PHASE_07D_MANAGEMENT_ACCOUNTING_DECISIONS_AR.md):
 * - No implicit surcharge defaults.
 * - Surcharges of 0.0 require explicit contractual proof and rationale (not assumed).
 * - Full verification and frozen state enforcement.
 * - Zero database writes (in-memory validation & intake template).
 */

import type { SurchargeCombinationRule, SurchargePolicySourceType } from "@prisma/client";

export const VALID_GERMAN_FEDERAL_STATES = [
  "BW", // Baden-Württemberg
  "BY", // Bayern
  "BE", // Berlin
  "BB", // Brandenburg
  "HB", // Bremen
  "HH", // Hamburg
  "HE", // Hessen
  "MV", // Mecklenburg-Vorpommern
  "NI", // Niedersachsen
  "NW", // Nordrhein-Westfalen
  "RP", // Rheinland-Pfalz
  "SL", // Saarland
  "SN", // Sachsen
  "ST", // Sachsen-Anhalt
  "SH", // Schleswig-Holstein
  "TH", // Thüringen
] as const;

export type GermanFederalState = typeof VALID_GERMAN_FEDERAL_STATES[number];

export interface FacilitySurchargePolicyIntakeInput {
  clientId: string;
  clientContractId?: string | null;
  policyVersion: number;
  federalState: GermanFederalState | string;
  municipality?: string | null;
  districtLocality?: string | null;
  surchargeSat: number;
  surchargeSun: number;
  surchargeHoliday: number;
  surchargeNight: number;
  nightStart: string; // HH:mm format, e.g. "20:00" or "22:00"
  nightEnd: string;   // HH:mm format, e.g. "06:00"
  combinationRule: SurchargeCombinationRule | "highest_non_night_plus_night" | "cumulative";
  sourceType: SurchargePolicySourceType | "contract" | "setting" | "local_exception";
  sourceReference: string; // Mandatory contract or administrative citation, e.g. "Rahmenvertrag 2026 §5 Abs. 2"
  effectiveFrom: string | Date; // YYYY-MM-DD or Date
  effectiveTo?: string | Date | null;
  verifiedByUserId: string;
  verifiedAt: string | Date;
  isFrozen: boolean;
  zeroRateRationale?: {
    surchargeSat?: string;
    surchargeSun?: string;
    surchargeHoliday?: string;
    surchargeNight?: string;
  };
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedPolicy?: {
    clientId: string;
    clientContractId: string | null;
    policyVersion: number;
    federalState: string;
    municipality: string | null;
    districtLocality: string | null;
    surchargeSat: number;
    surchargeSun: number;
    surchargeHoliday: number;
    surchargeNight: number;
    nightStart: string;
    nightEnd: string;
    combinationRule: SurchargeCombinationRule;
    sourceType: SurchargePolicySourceType;
    sourceReference: string;
    verifiedByUserId: string;
    verifiedAt: Date;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    isFrozen: boolean;
  };
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validates a facility surcharge policy intake record strictly fail-closed.
 * Guarantees no implicit zeros, no missing fields, and valid date/time bounds.
 */
export function validateFacilitySurchargePolicyIntake(
  input: unknown
): PolicyValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Eingabedaten für die Zuschlagsrichtlinie fehlen oder sind kein gültiges Objekt."],
    };
  }

  const p = input as Partial<FacilitySurchargePolicyIntakeInput>;

  // 1. Client ID
  if (!p.clientId || typeof p.clientId !== "string" || !p.clientId.trim()) {
    errors.push("Pflichtfeld 'clientId' fehlt oder ist leer.");
  }

  // 2. Policy Version
  if (
    typeof p.policyVersion !== "number" ||
    !Number.isInteger(p.policyVersion) ||
    p.policyVersion <= 0
  ) {
    errors.push("'policyVersion' muss eine positive Ganzzahl größer als 0 sein.");
  }

  // 3. Federal State
  if (
    !p.federalState ||
    typeof p.federalState !== "string" ||
    !VALID_GERMAN_FEDERAL_STATES.includes(p.federalState as GermanFederalState)
  ) {
    errors.push(
      `'federalState' muss ein gültiger Bundesland-Code sein (zulässig: ${VALID_GERMAN_FEDERAL_STATES.join(", ")}).`
    );
  }

  // 4. Time Windows (nightStart, nightEnd)
  if (!p.nightStart || typeof p.nightStart !== "string" || !TIME_REGEX.test(p.nightStart.trim())) {
    errors.push("'nightStart' muss im Format 'HH:mm' angegeben werden (z. B. '22:00').");
  }
  if (!p.nightEnd || typeof p.nightEnd !== "string" || !TIME_REGEX.test(p.nightEnd.trim())) {
    errors.push("'nightEnd' muss im Format 'HH:mm' angegeben werden (z. B. '06:00').");
  }

  // 5. Combination Rule
  const validCombinationRules: SurchargeCombinationRule[] = [
    "highest_non_night_plus_night",
    "cumulative",
  ];
  if (!p.combinationRule || !validCombinationRules.includes(p.combinationRule as SurchargeCombinationRule)) {
    errors.push(
      `'combinationRule' ist ungültig (zulässig: ${validCombinationRules.join(", ")}).`
    );
  }

  // 6. Source Type
  const validSourceTypes: SurchargePolicySourceType[] = [
    "contract",
    "setting",
    "local_exception",
  ];
  if (!p.sourceType || !validSourceTypes.includes(p.sourceType as SurchargePolicySourceType)) {
    errors.push(
      `'sourceType' ist ungültig (zulässig: ${validSourceTypes.join(", ")}).`
    );
  }

  // 7. Source Reference (Contract citation)
  if (!p.sourceReference || typeof p.sourceReference !== "string" || !p.sourceReference.trim()) {
    errors.push(
      "Pflichtfeld 'sourceReference' (Vertragsnachweis/Beschlussreferenz) fehlt oder ist leer."
    );
  }

  // 8. Surcharges (Sat, Sun, Holiday, Night)
  const surcharges = [
    { key: "surchargeSat", label: "Samstagszuschlag", val: p.surchargeSat },
    { key: "surchargeSun", label: "Sonntagszuschlag", val: p.surchargeSun },
    { key: "surchargeHoliday", label: "Feiertagszuschlag", val: p.surchargeHoliday },
    { key: "surchargeNight", label: "Nachtzuschlag", val: p.surchargeNight },
  ] as const;

  for (const s of surcharges) {
    if (typeof s.val !== "number" || isNaN(s.val) || !isFinite(s.val)) {
      errors.push(`'${s.key}' (${s.label}) muss eine gültige Zahl sein.`);
    } else if (s.val < 0) {
      errors.push(`'${s.key}' (${s.label}) darf nicht negativ sein.`);
    } else if (s.val > 2.0) {
      errors.push(`'${s.key}' (${s.label}) darf 200% (2.0) nicht überschreiten.`);
    } else if (s.val === 0 && p.sourceType !== "setting") {
      // Contract-sourced zero rates retain their documentary rationale.
      // An administrator-confirmed setting already records an explicit 0% value.
      const rationale = p.zeroRateRationale?.[s.key];
      if (!rationale || typeof rationale !== "string" || !rationale.trim()) {
        errors.push(
          `'${s.key}' ist mit 0,00% angegeben. Ein Null-Zuschlag darf nicht implizit angenommen werden, sondern erfordert eine dokumentierte vertragliche Begründung ('zeroRateRationale.${s.key}').`
        );
      }
    }
  }

  // 9. Dates (effectiveFrom, effectiveTo)
  let effectiveFromDate: Date | null = null;
  let effectiveToDate: Date | null = null;

  if (!p.effectiveFrom) {
    errors.push("Pflichtfeld 'effectiveFrom' fehlt.");
  } else {
    effectiveFromDate = new Date(p.effectiveFrom);
    if (isNaN(effectiveFromDate.getTime())) {
      errors.push("'effectiveFrom' ist kein gültiges Datum.");
    }
  }

  if (p.effectiveTo) {
    effectiveToDate = new Date(p.effectiveTo);
    if (isNaN(effectiveToDate.getTime())) {
      errors.push("'effectiveTo' ist kein gültiges Datum.");
    }
  }

  if (effectiveFromDate && effectiveToDate && effectiveFromDate > effectiveToDate) {
    errors.push(
      `'effectiveFrom' (${effectiveFromDate.toISOString().slice(0, 10)}) darf nicht nach 'effectiveTo' (${effectiveToDate.toISOString().slice(0, 10)}) liegen.`
    );
  }

  // 10. Verification & Freeze state
  if (!p.verifiedByUserId || typeof p.verifiedByUserId !== "string" || !p.verifiedByUserId.trim()) {
    errors.push("Pflichtfeld 'verifiedByUserId' (Prüfender Administrator) fehlt.");
  }

  let verifiedAtDate: Date | null = null;
  if (!p.verifiedAt) {
    errors.push("Pflichtfeld 'verifiedAt' (Prüfzeitpunkt) fehlt.");
  } else {
    verifiedAtDate = new Date(p.verifiedAt);
    if (isNaN(verifiedAtDate.getTime())) {
      errors.push("'verifiedAt' ist kein gültiges Datum.");
    }
  }

  if (p.isFrozen !== true) {
    errors.push(
      "Die Richtlinie muss zur Aktivierung verbindlich eingefroren sein ('isFrozen' muss true sein, um POLICY_NOT_FROZEN zu verhindern)."
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    sanitizedPolicy: {
      clientId: p.clientId!.trim(),
      clientContractId: p.clientContractId?.trim() || null,
      policyVersion: p.policyVersion!,
      federalState: p.federalState!.trim(),
      municipality: p.municipality?.trim() || null,
      districtLocality: p.districtLocality?.trim() || null,
      surchargeSat: p.surchargeSat!,
      surchargeSun: p.surchargeSun!,
      surchargeHoliday: p.surchargeHoliday!,
      surchargeNight: p.surchargeNight!,
      nightStart: p.nightStart!.trim(),
      nightEnd: p.nightEnd!.trim(),
      combinationRule: p.combinationRule as SurchargeCombinationRule,
      sourceType: p.sourceType as SurchargePolicySourceType,
      sourceReference: p.sourceReference!.trim(),
      verifiedByUserId: p.verifiedByUserId!.trim(),
      verifiedAt: verifiedAtDate!,
      effectiveFrom: effectiveFromDate!,
      effectiveTo: effectiveToDate,
      isFrozen: true,
    },
  };
}
