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
  isValidGregorianCalendarDate,
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
  districtLocality?: string | null;
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
  | "MISSING_POLICY_VERSION"
  | "UNKNOWN_FEDERAL_STATE"
  | "AMBIGUOUS_MUNICIPAL_LOCATION"
  | "POLICY_NOT_YET_EFFECTIVE"
  | "POLICY_EXPIRED"
  | "INVALID_SURCHARGE_RATES"
  | "INVALID_NIGHT_WINDOW"
  | "INVALID_COMBINATION_RULE"
  | "UNVERIFIED_POLICY_SOURCE"
  | "INVALID_REFERENCE_DATE"
  | "INVALID_DATE_INTERVAL"
  | "INVALID_CALENDAR_DATE"
  | "INVALID_MINUTE_OF_DAY"
  | "INVALID_VERIFICATION_METADATA"
  | "TAMPERED_FROZEN_POLICY"
  | "INVALID_DATE";

export type ResolvedSurchargePolicySuccess = {
  status: "resolved";
  policyId: string;
  policyVersion: number;
  clientId: string;
  clientContractId: string | null;
  federalState: GermanFederalState;
  federalStateNameDE: string;
  municipality: string | null;
  districtLocality: string | null;
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
    policyVersion?: number | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    nightStart?: string | null;
    nightEnd?: string | null;
    combinationRule?: string | null;
    sourceType?: string | null;
    verifiedAt?: string | null;
    expectedHash?: string;
    actualHash?: string | null;
    details?: unknown;
    [key: string]: unknown;
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
  districtLocality?: string | null;
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
    districtLocality: terms.districtLocality || null,
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
/**
 * Validates that multiple policies for the same client have non-overlapping effective intervals.
 * An interval [from, to] (where null to means infinity) overlaps another [from2, to2] if:
 * from <= (to2 ?? infinity) AND from2 <= (to ?? infinity).
 */
export function validatePolicyIntervalOverlap(
  policies: FacilitySurchargePolicyRecord[]
): {
  valid: boolean;
  conflict?: {
    policyA: FacilitySurchargePolicyRecord;
    policyB: FacilitySurchargePolicyRecord;
    reason: string;
  };
} {
  const byClient = new Map<string, FacilitySurchargePolicyRecord[]>();
  for (const p of policies) {
    const list = byClient.get(p.clientId) || [];
    list.push(p);
    byClient.set(p.clientId, list);
  }

  for (const [clientId, list] of byClient.entries()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aFrom = toIsoDay(a.effectiveFrom);
        const aTo = a.effectiveTo ? toIsoDay(a.effectiveTo) : null;
        const bFrom = toIsoDay(b.effectiveFrom);
        const bTo = b.effectiveTo ? toIsoDay(b.effectiveTo) : null;

        if (!aFrom || !bFrom) continue;

        const aBeforeBEnd = bTo === null || aFrom <= bTo;
        const bBeforeAEnd = aTo === null || bFrom <= aTo;

        if (aBeforeBEnd && bBeforeAEnd) {
          return {
            valid: false,
            conflict: {
              policyA: a,
              policyB: b,
              reason: `Gültigkeitszeiträume überschneiden sich für Mandant ${clientId}: [${aFrom}..${aTo ?? "offen"}] und [${bFrom}..${bTo ?? "offen"}].`,
            },
          };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Resolves and validates a facility surcharge policy against a reference shift/invoice date.
 * Returns an immutable ResolvedSurchargePolicySuccess or explicit diagnostic ResolvedSurchargePolicyError.
 *
 * NOTE: Application-level `isFrozen` verification protects integrity against runtime drift.
 * In a multi-user production environment, true immutability requires database write triggers
 * or Row-Level Security (RLS) to reject UPDATE/DELETE statements on frozen policies directly.
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

  const [refY, refM, refD] = refDay.split("-").map(Number);
  if (!isValidGregorianCalendarDate(refY, refM, refD)) {
    return {
      status: "policy_unresolved",
      code: "INVALID_CALENDAR_DATE",
      message: `Ungültiges Kalenderdatum für die Zuschlagsauflösung: "${refDay}".`,
      diagnostics: { referenceDate: refDay },
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

  // 1. Validate Policy Version (mandatory positive integer, no implicit defaults)
  if (
    typeof policy.policyVersion !== "number" ||
    !Number.isInteger(policy.policyVersion) ||
    policy.policyVersion <= 0
  ) {
    return {
      status: "policy_unresolved",
      code: "MISSING_POLICY_VERSION",
      message:
        "Richtlinien-Version (policyVersion) fehlt oder ist ungültig. Es muss eine positive Ganzzahl angegeben werden (keine stillschweigenden Defaults).",
      diagnostics: {
        clientId: policy.clientId,
        policyVersion: policy.policyVersion,
      },
    };
  }
  const policyVersion = policy.policyVersion;

  // 2. Validate Federal State
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

  // 3. Validate Effective Dates & Interval
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

  const [efY, efM, efD] = effFrom.split("-").map(Number);
  if (!isValidGregorianCalendarDate(efY, efM, efD)) {
    return {
      status: "policy_unresolved",
      code: "INVALID_CALENDAR_DATE",
      message: `Ungültiges Kalenderdatum in effectiveFrom: "${effFrom}".`,
      diagnostics: { clientId: policy.clientId, effectiveFrom: effFrom },
    };
  }

  const effTo = policy.effectiveTo ? toIsoDay(policy.effectiveTo) : null;
  if (effTo) {
    const [etY, etM, etD] = effTo.split("-").map(Number);
    if (!isValidGregorianCalendarDate(etY, etM, etD)) {
      return {
        status: "policy_unresolved",
        code: "INVALID_CALENDAR_DATE",
        message: `Ungültiges Kalenderdatum in effectiveTo: "${effTo}".`,
        diagnostics: { clientId: policy.clientId, effectiveTo: effTo },
      };
    }
    if (effFrom > effTo) {
      return {
        status: "policy_unresolved",
        code: "INVALID_DATE_INTERVAL",
        message: `Ungültiger Gültigkeitszeitraum: effectiveFrom (${effFrom}) darf nicht nach effectiveTo (${effTo}) liegen.`,
        diagnostics: { clientId: policy.clientId, effectiveFrom: effFrom, effectiveTo: effTo },
      };
    }
  }

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

  // 4. Validate Surcharge Rates
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

  // 5. Validate Night Window (mandatory, no implicit defaults)
  if (!policy.nightStart || !policy.nightEnd) {
    return {
      status: "policy_unresolved",
      code: "INVALID_NIGHT_WINDOW",
      message:
        "Nachtzeitfenster (nightStart und nightEnd) muss explizit angegeben werden (keine stillschweigenden Defaults).",
      diagnostics: {
        clientId: policy.clientId,
        nightStart: policy.nightStart,
        nightEnd: policy.nightEnd,
      },
    };
  }
  const nightStart = policy.nightStart.trim();
  const nightEnd = policy.nightEnd.trim();
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

  // 6. Validate Combination Rule (mandatory, no implicit defaults)
  if (!policy.combinationRule) {
    return {
      status: "policy_unresolved",
      code: "INVALID_COMBINATION_RULE",
      message:
        "Kombinationsregel (combinationRule) muss explizit angegeben werden (highest_non_night_plus_night oder cumulative).",
      diagnostics: { clientId: policy.clientId, combinationRule: policy.combinationRule },
    };
  }
  if (
    policy.combinationRule !== "highest_non_night_plus_night" &&
    policy.combinationRule !== "cumulative"
  ) {
    return {
      status: "policy_unresolved",
      code: "INVALID_COMBINATION_RULE",
      message: `Ungültige Zuschlagskombinationsregel: "${String(policy.combinationRule)}".`,
      diagnostics: { clientId: policy.clientId, combinationRule: policy.combinationRule },
    };
  }
  const combinationRule = policy.combinationRule;

  // 7. Validate Source & Provenance (mandatory, no implicit defaults)
  if (!policy.sourceType) {
    return {
      status: "policy_unresolved",
      code: "UNVERIFIED_POLICY_SOURCE",
      message:
        "Quellentyp (sourceType) muss explizit angegeben werden (contract, setting oder local_exception).",
      diagnostics: { clientId: policy.clientId, sourceType: policy.sourceType },
    };
  }
  if (
    policy.sourceType !== "contract" &&
    policy.sourceType !== "setting" &&
    policy.sourceType !== "local_exception"
  ) {
    return {
      status: "policy_unresolved",
      code: "UNVERIFIED_POLICY_SOURCE",
      message: `Ungültiger Quellentyp: "${String(policy.sourceType)}".`,
      diagnostics: { clientId: policy.clientId, sourceType: policy.sourceType },
    };
  }
  const sourceType = policy.sourceType;

  if (!policy.sourceReference || !policy.sourceReference.trim()) {
    return {
      status: "policy_unresolved",
      code: "UNVERIFIED_POLICY_SOURCE",
      message:
        "Zuschlagsrichtlinie besitzt keinen dokumentierten Quellverweis (sourceReference fehlt).",
      diagnostics: {
        clientId: policy.clientId,
        referenceDate: refDay,
        details: "sourceReference is empty",
      },
    };
  }

  // 8. Enforce source provenance verification:
  // Setting & local_exception MUST be verified by an authorized user (verifiedByUserId + verifiedAt)
  if (sourceType === "setting" || sourceType === "local_exception") {
    if (!policy.verifiedByUserId || !policy.verifiedByUserId.trim() || policy.verifiedAt == null) {
      return {
        status: "policy_unresolved",
        code: "UNVERIFIED_POLICY_SOURCE",
        message: `Zuschlagsrichtlinien vom Quellentyp "${sourceType}" müssen durch einen autorisierten Benutzer verifiziert sein (verifiedByUserId und verifiedAt sind Pflichtangaben, reiner Freitext in sourceReference reicht nicht aus).`,
        diagnostics: {
          clientId: policy.clientId,
          sourceType,
          sourceReference: policy.sourceReference,
          verifiedByUserId: policy.verifiedByUserId || null,
          verifiedAt: policy.verifiedAt
            ? (policy.verifiedAt instanceof Date ? policy.verifiedAt.toISOString() : String(policy.verifiedAt))
            : null,
        },
      };
    }
  }

  // Contract MUST have either clientContractId OR (verifiedByUserId + verifiedAt)
  if (sourceType === "contract") {
    const hasContractId = Boolean(policy.clientContractId && policy.clientContractId.trim());
    const hasUserVerification = Boolean(
      policy.verifiedByUserId && policy.verifiedByUserId.trim() && policy.verifiedAt != null
    );
    if (!hasContractId && !hasUserVerification) {
      return {
        status: "policy_unresolved",
        code: "UNVERIFIED_POLICY_SOURCE",
        message:
          'Vertragsbasierte Zuschlagsrichtlinien (sourceType="contract") müssen entweder eine verknüpfte clientContractId besitzen oder mit Benutzer-Verifizierungsdaten (verifiedByUserId und verifiedAt) versehen sein.',
        diagnostics: {
          clientId: policy.clientId,
          sourceType,
          clientContractId: policy.clientContractId || null,
          sourceReference: policy.sourceReference,
          verifiedByUserId: policy.verifiedByUserId || null,
          verifiedAt: policy.verifiedAt
            ? (policy.verifiedAt instanceof Date ? policy.verifiedAt.toISOString() : String(policy.verifiedAt))
            : null,
        },
      };
    }
  }

  // 9. Validate verifiedAt safely without unhandled JS exceptions
  let verifiedAtIso: string | null = null;
  if (policy.verifiedAt != null) {
    if (policy.verifiedAt instanceof Date) {
      if (isNaN(policy.verifiedAt.getTime())) {
        return {
          status: "policy_unresolved",
          code: "INVALID_VERIFICATION_METADATA",
          message: "Ungültiges verifiedAt-Datum (NaN).",
          diagnostics: { clientId: policy.clientId, verifiedAt: String(policy.verifiedAt) },
        };
      }
      verifiedAtIso = policy.verifiedAt.toISOString();
    } else if (typeof policy.verifiedAt === "string") {
      const parsed = new Date(policy.verifiedAt);
      if (isNaN(parsed.getTime())) {
        return {
          status: "policy_unresolved",
          code: "INVALID_VERIFICATION_METADATA",
          message: `Ungültiger verifiedAt-Zeitstempel: "${policy.verifiedAt}".`,
          diagnostics: { clientId: policy.clientId, verifiedAt: policy.verifiedAt },
        };
      }
      verifiedAtIso = parsed.toISOString();
    } else {
      return {
        status: "policy_unresolved",
        code: "INVALID_VERIFICATION_METADATA",
        message: "verifiedAt muss ein Date-Objekt oder ISO-String sein.",
        diagnostics: { clientId: policy.clientId },
      };
    }
  }

  const policyId = policy.id || `policy-${policy.clientId}-v${policyVersion}`;
  const municipality = policy.municipality?.trim() || null;
  const districtLocality = policy.districtLocality?.trim() || null;

  const termsToHash = {
    clientId: policy.clientId,
    clientContractId: policy.clientContractId || null,
    policyVersion,
    federalState,
    municipality,
    districtLocality,
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

  // 10. Tampered Frozen Policy Hash Enforcement:
  // If policy is frozen, stored hash MUST match calculated terms hash exactly.
  if (policy.isFrozen === true) {
    if (!policy.frozenHash || policy.frozenHash !== calculatedHash) {
      return {
        status: "policy_unresolved",
        code: "TAMPERED_FROZEN_POLICY",
        message: `Eingefrorene Richtlinie (isFrozen = true) besitzt eine ungültige oder manipulierte Prüfsumme. Erwartet: ${calculatedHash}, Hinterlegt: ${policy.frozenHash || "null"}.`,
        diagnostics: {
          clientId: policy.clientId,
          policyVersion,
          expectedHash: calculatedHash,
          actualHash: policy.frozenHash || null,
          details: "FROZEN_POLICY_HASH_MISMATCH",
        },
      };
    }
  }

  return {
    status: "resolved",
    policyId,
    policyVersion,
    clientId: policy.clientId,
    clientContractId: policy.clientContractId || null,
    federalState,
    federalStateNameDE: GERMAN_STATE_NAMES_DE[federalState],
    municipality,
    districtLocality,
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
    verifiedAt: verifiedAtIso,
    effectiveFrom: effFrom,
    effectiveTo: effTo,
    isFrozen: Boolean(policy.isFrozen),
    frozenHash: calculatedHash,
  };
}

export type SurchargeComponent = "sat" | "sun" | "holiday" | "night";

export type MinuteSurchargeEvaluationSuccess = {
  status: "resolved";
  date: string;
  minuteOfDay: number;
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

export type MinuteSurchargeEvaluationUnresolved = {
  status: "policy_unresolved";
  code:
    | PolicyUnresolvedCode
    | "INVALID_MINUTE_OF_DAY"
    | "INVALID_CALENDAR_DATE"
    | "POLICY_EXPIRED"
    | "POLICY_NOT_YET_EFFECTIVE";
  message: string;
  diagnostics: {
    dateIso?: string;
    minuteOfDay?: number;
    clientId?: string;
    federalState?: string;
    details?: unknown;
  };
};

export type MinuteSurchargeEvaluation =
  | MinuteSurchargeEvaluationSuccess
  | MinuteSurchargeEvaluationUnresolved;

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
 * Returns an explicit discriminated union:
 * - { status: "resolved", ... } when all rates and holiday statuses are unambiguously known.
 * - { status: "policy_unresolved", ... } when holiday resolution fails (e.g. ambiguous Bavarian municipality
 *   on August 15 or Fronleichnam in Saxony/Thuringia), policy is expired on the minute's day, or minute is invalid.
 */
export function evaluateMinuteSurcharges(
  dateIso: string, // "YYYY-MM-DD"
  minuteOfDay: number, // 0..1439
  policy: ResolvedSurchargePolicySuccess
): MinuteSurchargeEvaluation {
  // 1. Minute of day range check (0..1439)
  if (
    typeof minuteOfDay !== "number" ||
    !Number.isInteger(minuteOfDay) ||
    minuteOfDay < 0 ||
    minuteOfDay > 1439
  ) {
    return {
      status: "policy_unresolved",
      code: "INVALID_MINUTE_OF_DAY",
      message: `Ungültige Minute des Tages: ${minuteOfDay}. Erwartet wird eine ganze Zahl zwischen 0 und 1439.`,
      diagnostics: { dateIso, minuteOfDay, clientId: policy.clientId },
    };
  }

  // 2. Date string format and Gregorian calendar existence check
  if (typeof dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso.trim())) {
    return {
      status: "policy_unresolved",
      code: "INVALID_CALENDAR_DATE",
      message: `Ungültiges Datumsformat für die Minute: "${dateIso}". Erwartet wird YYYY-MM-DD.`,
      diagnostics: { dateIso, minuteOfDay, clientId: policy.clientId },
    };
  }

  const cleanDateIso = dateIso.trim();
  const [y, m, d] = cleanDateIso.split("-").map(Number);
  if (!isValidGregorianCalendarDate(y, m, d)) {
    return {
      status: "policy_unresolved",
      code: "INVALID_CALENDAR_DATE",
      message: `Ungültiges Kalenderdatum für die Minute: "${cleanDateIso}" existiert nicht im gregorianischen Kalender.`,
      diagnostics: { dateIso: cleanDateIso, minuteOfDay, clientId: policy.clientId },
    };
  }

  // 3. Validate policy effective window against the actual minute's calendar date
  if (cleanDateIso < policy.effectiveFrom) {
    return {
      status: "policy_unresolved",
      code: "POLICY_NOT_YET_EFFECTIVE",
      message: `Die Richtlinie ist am Datum der Minute (${cleanDateIso}) noch nicht in Kraft (Gültig ab: ${policy.effectiveFrom}).`,
      diagnostics: {
        dateIso: cleanDateIso,
        minuteOfDay,
        clientId: policy.clientId,
        details: { effectiveFrom: policy.effectiveFrom, minuteDate: cleanDateIso },
      },
    };
  }

  if (policy.effectiveTo && cleanDateIso > policy.effectiveTo) {
    return {
      status: "policy_unresolved",
      code: "POLICY_EXPIRED",
      message: `Die Richtlinie ist am Datum der Minute (${cleanDateIso}) abgelaufen (Gültig bis: ${policy.effectiveTo}).`,
      diagnostics: {
        dateIso: cleanDateIso,
        minuteOfDay,
        clientId: policy.clientId,
        details: { effectiveTo: policy.effectiveTo, minuteDate: cleanDateIso },
      },
    };
  }

  // 4. Resolve statutory holiday and explicitly fail if unresolved (no silent fallback to regular day)
  const holidayRes = resolveGermanHoliday(
    cleanDateIso,
    policy.federalState,
    policy.municipality,
    undefined,
    policy.districtLocality
  );
  if (holidayRes.status === "policy_unresolved") {
    return {
      status: "policy_unresolved",
      code: holidayRes.code,
      message: `Feiertagsprüfung für Minute am ${cleanDateIso} konnte nicht aufgelöst werden: ${holidayRes.message}`,
      diagnostics: {
        dateIso: cleanDateIso,
        minuteOfDay,
        clientId: policy.clientId,
        federalState: policy.federalState,
        details: holidayRes.diagnostics,
      },
    };
  }

  const isHoliday = holidayRes.isHoliday;
  const holidayRecord = holidayRes.holiday;

  // 5. Calendar day properties in UTC
  const dateUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dateUtc.getUTCDay(); // 0 = Sun, 6 = Sat

  const isSaturday = dayOfWeek === 6;
  const isSunday = dayOfWeek === 0;
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
    status: "resolved",
    date: cleanDateIso,
    minuteOfDay,
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
