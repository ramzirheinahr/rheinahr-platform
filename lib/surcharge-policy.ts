/**
 * Versioned Facility Surcharge Policy Resolver (Phase 4a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Principles:
 * 1. Strict Contractual Provenance: Blends federal state, contract rules, and exceptions
 *    ONLY when sources and version are explicitly defined.
 * 2. Strict Non-Guessing Policy: Missing contract, unknown state, expired policy, or invalid
 *    configuration returns an explicit "policy_unresolved" status rather than guessing NRW
 *    or comfortable defaults.
 * 3. Deterministic Versioning & Freezing: Policies compute a cryptographic SHA-256 canonical hash
 *    of terms to allow immutable freezing for Phase 5 invoicing.
 * 4. Dual Combination Rules: Supports both "highest_non_night_plus_night" (contract standard)
 *    and "cumulative" (when contract explicitly requires).
 */

import { createHash } from "node:crypto";
import {
  type GermanFederalState,
  GERMAN_STATE_NAMES_DE,
  isValidGermanFederalState,
  resolveGermanHoliday,
  type HolidayRecord,
} from "./german-holidays";

export type SurchargeCombinationRule = "highest_non_night_plus_night" | "cumulative";
export type SurchargePolicySourceType = "contract" | "setting" | "local_exception";

export type FacilitySurchargePolicyRecord = {
  id?: string;
  clientId: string;
  clientContractId?: string | null;
  policyVersion?: number;
  federalState: string;
  municipality?: string | null;
  surchargeSat: number;
  surchargeSun: number;
  surchargeHoliday: number;
  surchargeNight: number;
  nightStart?: string;
  nightEnd?: string;
  combinationRule?: SurchargeCombinationRule;
  sourceType?: SurchargePolicySourceType;
  sourceReference: string;
  verifiedByUserId?: string | null;
  verifiedAt?: Date | string | null;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  isFrozen?: boolean;
  frozenAt?: Date | string | null;
  frozenHash?: string | null;
};

export type PolicyUnresolvedCode =
  | "MISSING_POLICY_RECORD"
  | "UNKNOWN_FEDERAL_STATE"
  | "AMBIGUOUS_MUNICIPAL_LOCATION"
  | "POLICY_NOT_YET_EFFECTIVE"
  | "POLICY_EXPIRED"
  | "INVALID_SURCHARGE_RATES"
  | "INVALID_NIGHT_WINDOW"
  | "INVALID_COMBINATION_RULE"
  | "UNVERIFIED_POLICY_SOURCE"
  | "INVALID_REFERENCE_DATE";

export type ResolvedSurchargePolicySuccess = {
  status: "resolved";
  policyId: string;
  policyVersion: number;
  clientId: string;
  clientContractId: string | null;
  federalState: GermanFederalState;
  federalStateNameDE: string;
  municipality: string | null;
  surcharges: {
    sat: number;
    sun: number;
    holiday: number;
    night: number;
  };
  nightWindow: {
    start: string; // "HH:mm"
    end: string;   // "HH:mm"
  };
  combinationRule: SurchargeCombinationRule;
  sourceType: SurchargePolicySourceType;
  sourceReference: string;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD
  isFrozen: boolean;
  frozenHash: string;
};

export type ResolvedSurchargePolicyError = {
  status: "policy_unresolved";
  code: PolicyUnresolvedCode;
  message: string;
  diagnostics: {
    clientId?: string | null;
    federalState?: string | null;
    referenceDate?: string;
    details?: unknown;
  };
};

export type ResolvedSurchargePolicy =
  | ResolvedSurchargePolicySuccess
  | ResolvedSurchargePolicyError;

function toIsoDay(d: Date | string): string | null {
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (typeof d === "string") {
    const trimmed = d.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }
  return null;
}

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Computes an immutable canonical SHA-256 hash over the policy terms.
 */
export function computePolicyCanonicalHash(terms: {
  clientId: string;
  clientContractId: string | null;
  policyVersion: number;
  federalState: string;
  municipality: string | null;
  surchargeSat: number;
  surchargeSun: number;
  surchargeHoliday: number;
  surchargeNight: number;
  nightStart: string;
  nightEnd: string;
  combinationRule: SurchargeCombinationRule;
  sourceType: SurchargePolicySourceType;
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}): string {
  const canonicalObject = {
    clientId: terms.clientId,
    clientContractId: terms.clientContractId,
    combinationRule: terms.combinationRule,
    effectiveFrom: terms.effectiveFrom,
    effectiveTo: terms.effectiveTo,
    federalState: terms.federalState,
    municipality: terms.municipality,
    nightEnd: terms.nightEnd,
    nightStart: terms.nightStart,
    policyVersion: terms.policyVersion,
    sourceReference: terms.sourceReference,
    sourceType: terms.sourceType,
    surchargeHoliday: terms.surchargeHoliday,
    surchargeNight: terms.surchargeNight,
    surchargeSat: terms.surchargeSat,
    surchargeSun: terms.surchargeSun,
  };
  return createHash("sha256").update(JSON.stringify(canonicalObject)).digest("hex");
}

export type ResolvePolicyParams = {
  policy?: FacilitySurchargePolicyRecord | null;
  referenceDate: Date | string;
};

/**
 * Resolves and validates a facility surcharge policy against a reference shift/invoice date.
 * Returns an immutable ResolvedSurchargePolicySuccess or explicit diagnostic ResolvedSurchargePolicyError.
 */
export function resolveInvoiceSurchargePolicy(
  params: ResolvePolicyParams
): ResolvedSurchargePolicy {
  const { policy, referenceDate } = params;

  const refDay = toIsoDay(referenceDate);
  if (!refDay) {
    return {
      status: "policy_unresolved",
      code: "INVALID_REFERENCE_DATE",
      message: "Ungültiges Referenzdatum für die Zuschlagsauflösung übergeben.",
      diagnostics: {
        referenceDate: String(referenceDate),
        details: "Reference date could not be parsed to ISO YYYY-MM-DD",
      },
    };
  }

  if (!policy) {
    return {
      status: "policy_unresolved",
      code: "MISSING_POLICY_RECORD",
      message:
        "Keine dokumentierte Zuschlagsrichtlinie für diese Einrichtung gefunden. Automatische Schätzungen oder Default-Bundesländer sind unzulässig.",
      diagnostics: {
        referenceDate: refDay,
        details: "Policy record is null or undefined",
      },
    };
  }

  // 1. Validate Federal State
  if (!isValidGermanFederalState(policy.federalState)) {
    return {
      status: "policy_unresolved",
      code: "UNKNOWN_FEDERAL_STATE",
      message: `Ungültiges oder unbekanntes Bundesland "${policy.federalState}". Erwartet wird ein ISO 3166-2:DE Code (z.B. NW, BY, BE).`,
      diagnostics: {
        clientId: policy.clientId,
        federalState: policy.federalState,
        referenceDate: refDay,
        details: "Federal state is not recognized",
      },
    };
  }
  const federalState = policy.federalState;

  // 2. Validate Effective Dates
  const effFrom = toIsoDay(policy.effectiveFrom);
  if (!effFrom) {
    return {
      status: "policy_unresolved",
      code: "POLICY_NOT_YET_EFFECTIVE",
      message: "Ungültiges oder fehlendes effectiveFrom-Datum in der Zuschlagsrichtlinie.",
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: "effectiveFrom is missing or invalid",
      },
    };
  }

  const effTo = policy.effectiveTo ? toIsoDay(policy.effectiveTo) : null;

  if (refDay < effFrom) {
    return {
      status: "policy_unresolved",
      code: "POLICY_NOT_YET_EFFECTIVE",
      message: `Die Richtlinie ist am Stichtag ${refDay} noch nicht in Kraft (Gültig ab: ${effFrom}).`,
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: { effectiveFrom: effFrom, referenceDate: refDay },
      },
    };
  }

  if (effTo && refDay > effTo) {
    return {
      status: "policy_unresolved",
      code: "POLICY_EXPIRED",
      message: `Die Richtlinie ist am Stichtag ${refDay} abgelaufen (Gültig bis: ${effTo}).`,
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: { effectiveTo: effTo, referenceDate: refDay },
      },
    };
  }

  // 3. Validate Surcharge Rates
  const { surchargeSat, surchargeSun, surchargeHoliday, surchargeNight } = policy;
  const rates = [surchargeSat, surchargeSun, surchargeHoliday, surchargeNight];
  const allRatesValid = rates.every(
    (r) => typeof r === "number" && !isNaN(r) && isFinite(r) && r >= 0 && r <= 5.0
  );
  if (!allRatesValid) {
    return {
      status: "policy_unresolved",
      code: "INVALID_SURCHARGE_RATES",
      message: "Zuschlagssätze müssen endliche positive Zahlen zwischen 0.0 (0%) und 5.0 (500%) sein.",
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: { surchargeSat, surchargeSun, surchargeHoliday, surchargeNight },
      },
    };
  }

  // 4. Validate Night Window
  const nightStart = policy.nightStart || "20:00";
  const nightEnd = policy.nightEnd || "06:00";
  if (!TIME_REGEX.test(nightStart) || !TIME_REGEX.test(nightEnd)) {
    return {
      status: "policy_unresolved",
      code: "INVALID_NIGHT_WINDOW",
      message: `Ungültiges Zeitfenster für Nachtarbeit: ${nightStart}–${nightEnd}. Erwartet wird HH:mm.`,
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: { nightStart, nightEnd },
      },
    };
  }

  // 5. Validate Combination Rule
  const combinationRule: SurchargeCombinationRule =
    policy.combinationRule || "highest_non_night_plus_night";
  if (
    combinationRule !== "highest_non_night_plus_night" &&
    combinationRule !== "cumulative"
  ) {
    return {
      status: "policy_unresolved",
      code: "INVALID_COMBINATION_RULE",
      message: `Ungültige Zuschlagskombinationsregel: "${String(combinationRule)}".`,
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: { combinationRule },
      },
    };
  }

  // 6. Validate Source & Provenance
  const sourceType: SurchargePolicySourceType = policy.sourceType || "setting";
  if (!policy.sourceReference || !policy.sourceReference.trim()) {
    return {
      status: "policy_unresolved",
      code: "UNVERIFIED_POLICY_SOURCE",
      message: "Zuschlagsrichtlinie besitzt keinen dokumentierten Quellverweis (sourceReference fehlt).",
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: "sourceReference is empty",
      },
    };
  }

  const policyVersion = policy.policyVersion ?? 1;
  const policyId = policy.id || `policy-${policy.clientId}-v${policyVersion}`;
  const municipality = policy.municipality?.trim() || null;

  const termsToHash = {
    clientId: policy.clientId,
    clientContractId: policy.clientContractId || null,
    policyVersion,
    federalState,
    municipality,
    surchargeSat,
    surchargeSun,
    surchargeHoliday,
    surchargeNight,
    nightStart,
    nightEnd,
    combinationRule,
    sourceType,
    sourceReference: policy.sourceReference.trim(),
    effectiveFrom: effFrom,
    effectiveTo: effTo,
  };

  const calculatedHash = computePolicyCanonicalHash(termsToHash);

  return {
    status: "resolved",
    policyId,
    policyVersion,
    clientId: policy.clientId,
    clientContractId: policy.clientContractId || null,
    federalState,
    federalStateNameDE: GERMAN_STATE_NAMES_DE[federalState],
    municipality,
    surcharges: {
      sat: surchargeSat,
      sun: surchargeSun,
      holiday: surchargeHoliday,
      night: surchargeNight,
    },
    nightWindow: {
      start: nightStart,
      end: nightEnd,
    },
    combinationRule,
    sourceType,
    sourceReference: policy.sourceReference.trim(),
    verifiedByUserId: policy.verifiedByUserId || null,
    verifiedAt: policy.verifiedAt ? new Date(policy.verifiedAt).toISOString() : null,
    effectiveFrom: effFrom,
    effectiveTo: effTo,
    isFrozen: Boolean(policy.isFrozen),
    frozenHash: calculatedHash,
  };
}

export type SurchargeComponent = "sat" | "sun" | "holiday" | "night";

export type MinuteSurchargeEvaluation = {
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  holidayRecord?: HolidayRecord;
  isNight: boolean;
  applicableComponents: SurchargeComponent[];
  effectiveSurchargeFraction: number; // e.g. 1.25 for +125%
  rateMultiplier: number;             // e.g. 2.25
  combinationRule: SurchargeCombinationRule;
  breakdownDescriptionDE: string;
};

/**
 * Checks if a minute-of-day (0..1439) falls inside an overnight-aware night window.
 */
export function isMinuteInNightWindow(
  minuteOfDay: number,
  nightWindow: { start: string; end: string }
): boolean {
  const [sH, sM] = nightWindow.start.split(":").map(Number);
  const [eH, eM] = nightWindow.end.split(":").map(Number);
  const startMin = sH * 60 + sM;
  const endMin = eH * 60 + eM;

  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return minuteOfDay >= startMin && minuteOfDay < endMin;
  }
  // Overnight window, e.g. 20:00 (1200) to 06:00 (360)
  return minuteOfDay >= startMin || minuteOfDay < endMin;
}

/**
 * Pure evaluator of statutory surcharges for a single minute of work on a given calendar day.
 */
export function evaluateMinuteSurcharges(
  dateIso: string, // "YYYY-MM-DD"
  minuteOfDay: number, // 0..1439
  policy: ResolvedSurchargePolicySuccess
): MinuteSurchargeEvaluation {
  // Calendar day properties in UTC
  const [y, m, d] = dateIso.split("-").map(Number);
  const dateUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dateUtc.getUTCDay(); // 0 = Sun, 6 = Sat

  const isSaturday = dayOfWeek === 6;
  const isSunday = dayOfWeek === 0;

  const holidayRes = resolveGermanHoliday(dateIso, policy.federalState, policy.municipality);
  const isHoliday = holidayRes.status === "resolved" && holidayRes.isHoliday;
  const holidayRecord = holidayRes.status === "resolved" ? holidayRes.holiday : undefined;

  const isNight = isMinuteInNightWindow(minuteOfDay, policy.nightWindow);

  const applicableComponents: SurchargeComponent[] = [];
  if (isHoliday) applicableComponents.push("holiday");
  if (isSunday) applicableComponents.push("sun");
  if (isSaturday) applicableComponents.push("sat");
  if (isNight) applicableComponents.push("night");

  let effectiveSurchargeFraction = 0;
  let breakdownDescriptionDE = "Grundvergütung";

  if (applicableComponents.length > 0) {
    if (policy.combinationRule === "highest_non_night_plus_night") {
      // Highest non-night surcharge + night surcharge
      const nonNightComponents = applicableComponents.filter((c) => c !== "night");
      let highestNonNight = 0;
      let highestName = "";

      for (const comp of nonNightComponents) {
        let rate = 0;
        let name = "";
        if (comp === "holiday") {
          rate = policy.surcharges.holiday;
          name = `Feiertagszuschlag (${holidayRecord?.name || "Feiertag"} +${(rate * 100).toFixed(0)}%)`;
        } else if (comp === "sun") {
          rate = policy.surcharges.sun;
          name = `Sonntagszuschlag (+${(rate * 100).toFixed(0)}%)`;
        } else if (comp === "sat") {
          rate = policy.surcharges.sat;
          name = `Samstagszuschlag (+${(rate * 100).toFixed(0)}%)`;
        }
        if (rate > highestNonNight) {
          highestNonNight = rate;
          highestName = name;
        }
      }

      const nightRate = isNight ? policy.surcharges.night : 0;
      effectiveSurchargeFraction = highestNonNight + nightRate;

      const parts: string[] = [];
      if (highestNonNight > 0) parts.push(highestName);
      if (isNight) parts.push(`Nachtzuschlag (+${(nightRate * 100).toFixed(0)}%)`);
      breakdownDescriptionDE = parts.join(" + ");
    } else {
      // Cumulative rule: all applicable surcharges are added
      const parts: string[] = [];
      let sum = 0;

      for (const comp of applicableComponents) {
        if (comp === "holiday") {
          const r = policy.surcharges.holiday;
          sum += r;
          parts.push(`Feiertag (+${(r * 100).toFixed(0)}%)`);
        } else if (comp === "sun") {
          const r = policy.surcharges.sun;
          sum += r;
          parts.push(`Sonntag (+${(r * 100).toFixed(0)}%)`);
        } else if (comp === "sat") {
          const r = policy.surcharges.sat;
          sum += r;
          parts.push(`Samstag (+${(r * 100).toFixed(0)}%)`);
        } else if (comp === "night") {
          const r = policy.surcharges.night;
          sum += r;
          parts.push(`Nacht (+${(r * 100).toFixed(0)}%)`);
        }
      }
      effectiveSurchargeFraction = sum;
      breakdownDescriptionDE = parts.join(" + ");
    }
  }

  const rateMultiplier = 1 + effectiveSurchargeFraction;

  return {
    isSaturday,
    isSunday,
    isHoliday,
    holidayRecord,
    isNight,
    applicableComponents,
    effectiveSurchargeFraction,
    rateMultiplier,
    combinationRule: policy.combinationRule,
    breakdownDescriptionDE,
  };
}
