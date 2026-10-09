/**
 * Pure Shift Minute Splitting & Surcharge Engine (Phase 4b)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Principles:
 * 1. Strict Minute-Level Discretization:
 *    Partitions the entire shift into contiguous, non-overlapping minute intervals split
 *    at midnight (day/month/year boundary), day/holiday changes, night window boundaries,
 *    and break intervals.
 * 2. Statutory Policy Provenance & Integrity:
 *    Evaluates each minute against Phase 4a's frozen surcharge policy via `evaluateMinuteSurcharges`.
 *    If any minute is unresolved, the ENTIRE shift fails explicitly (no silent regular day pricing).
 * 3. Exact Break Allocation & Non-Guessing:
 *    Breaks are excluded from both base work and all surcharges.
 *    If only break duration is known (no timestamps) and the shift crosses surcharge categories,
 *    it fails with `UNRESOLVED_BREAK_ALLOCATION` unless an explicit contractual allocation rule exists.
 * 4. Zero Floating-Point Money & Display Aggregation Separation:
 *    Computes exact integer minutes. Never rounds minutes or applies floating-point money.
 *    Sum of interval durations equals net working minutes. Surcharges do not inflate base minutes.
 * 5. Timezone & DST Safety:
 *    Accurately handles `Europe/Berlin` wall clock and flags DST gap/ambiguity without guessing.
 */

import { formatInTimeZone } from "date-fns-tz";
import {
  evaluateMinuteSurcharges,
  computePolicyCanonicalHash,
  type ResolvedSurchargePolicySuccess,
  type SurchargeCombinationRule,
  type SurchargeComponent,
} from "./surcharge-policy";
import {
  DEFAULT_TIMEZONE,
  isValidTimeString,
  resolveWallTimeToUtc,
} from "./shift-overlap-engine";
import type { RawWorkLineInput } from "./invoice-exact-engine";

export type ShiftBreakWindow = {
  start: string | Date; // "HH:mm" or ISO string or Date
  end: string | Date;   // "HH:mm" or ISO string or Date
  dateIso?: string;     // Optional "YYYY-MM-DD" if "HH:mm" is supplied
};

export type ShiftMinuteSplitterInput = {
  shiftId: string;
  assignmentId?: string;
  orderId?: string;
  workerId: string;
  workerName?: string;
  clientId: string;
  facilityName?: string;
  qualification: string;

  // Date and Time (Local Wall Time or ISO)
  shiftDate?: string | Date; // "YYYY-MM-DD" or Date
  startTime?: string;        // "HH:mm"
  endTime?: string;          // "HH:mm"
  startDateTime?: string | Date;
  endDateTime?: string | Date;
  timeZone?: string;         // Default "Europe/Berlin"

  // Breaks
  breakMinutes?: number;
  breakWindows?: ShiftBreakWindow[];
  contractualBreakAllocationRule?: "proportional" | null;
  breakAllocationSourceReference?: string;
  verifiedBreakClause?: VerifiedContractBreakAllocationClause;

  // Phase 3c Effective Work Hours Provenance Reference
  effectiveWorkHoursRef: {
    effectiveHours: number;
    effectiveVersion: string;
    source: "approved_correction" | "service_confirmation" | "scheduled";
    isCorrected?: boolean;
    approvedCorrectionId?: string | null;
    approvedCorrectionRevision?: number | null;
  };

  // Phase 4a Frozen Facility Surcharge Policy
  policy: ResolvedSurchargePolicySuccess;
};

export type VerifiedContractBreakAllocationClause = {
  clientId: string;
  clientContractId: string;
  policyVersion: number;
  clauseReference: string;
  rule: "proportional";
  verifiedAt: string;
  verifiedBy: string;
};

export type ShiftMinuteInterval = {
  intervalIndex: number;
  dateIso: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number; // exclusive (0..1440)
  startTime: string;      // "HH:mm"
  endTime: string;        // "HH:mm"
  startDateTime?: string; // ISO 8601 UTC timestamp
  endDateTime?: string;   // ISO 8601 UTC timestamp
  durationMinutes: number;
  isNight: boolean;
  isSaturday: boolean;
  isSunday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  applicableComponents: SurchargeComponent[];
  effectiveSurchargeFraction: number;
  rateMultiplier: number;
  breakdownDescriptionDE: string;
};

export type ShiftBreakInterval = {
  intervalIndex: number;
  dateIso: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  startTime: string;
  endTime: string;
  startDateTime?: string;
  endDateTime?: string;
  durationMinutes: number;
};

export type PreparedWorkLineItem = {
  workerId: string;
  workerName?: string;
  qualification: string;
  itemCategory:
    | "base"
    | "surcharge_saturday"
    | "surcharge_sunday"
    | "surcharge_holiday"
    | "surcharge_night";
  surchargePolicyId: string;
  surchargePolicyVersion: number;
  minutes: number;
  surchargeFraction: number;  // Explicit incremental surcharge percentage (0 for base, +0.25 for +25%, etc.)
  rateMultiplier?: number;    // Diagnostic composite (1 + surchargeFraction)
  rateFraction?: number;      // Deprecated alias for surchargeFraction
  combinationRule: SurchargeCombinationRule;
  descriptionDE: string;
};

export type ShiftMinuteSplitSuccess = {
  status: "resolved";
  shiftId: string;
  assignmentId?: string;
  orderId?: string;
  workerId: string;
  workerName?: string;
  clientId: string;
  facilityName?: string;
  qualification: string;

  // Provenance & Versioning
  effectiveHoursVersion: string;
  effectiveHoursSource: string;
  policyId: string;
  policyVersion: number;
  policyFrozenHash: string;
  combinationRule: SurchargeCombinationRule;

  // Minute Aggregations
  grossShiftMinutes: number;
  breakMinutes: number;
  netWorkMinutes: number;

  // Non-inflating Surcharge Minutes
  surchargeMinutes: {
    saturdayMinutes: number;
    sundayMinutes: number;
    holidayMinutes: number;
    nightMinutes: number;
  };

  // Granular Partitioned Intervals
  intervals: ShiftMinuteInterval[];

  // Break Intervals
  breakIntervals: ShiftBreakInterval[];

  // Prepared Line Items for Phase 5 exact billing
  preparedLineItems: PreparedWorkLineItem[];
};

export type ShiftMinuteSplitUnresolvedCode =
  | "POLICY_UNRESOLVED"
  | "UNRESOLVED_BREAK_ALLOCATION"
  | "BREAK_EXCEEDS_SHIFT_DURATION"
  | "BREAK_WINDOW_OUTSIDE_SHIFT"
  | "OVERLAPPING_BREAK_WINDOWS"
  | "INVALID_BREAK_DURATION"
  | "INVALID_EFFECTIVE_HOURS"
  | "DST_GAP"
  | "DST_AMBIGUOUS"
  | "TIME_AMBIGUOUS_OR_INVALID"
  | "INVALID_TIME_INTERVAL"
  | "INVALID_TIME_FORMAT"
  | "POLICY_NOT_FROZEN"
  | "POLICY_EXPIRED"
  | "POLICY_NOT_YET_EFFECTIVE"
  | "CLIENT_POLICY_MISMATCH"
  | "MISSING_POLICY"
  | "MISSING_EFFECTIVE_HOURS_VERSION"
  | "EFFECTIVE_HOURS_MISMATCH"
  | "MISSING_WORKER_ID"
  | "MISSING_CLIENT_ID"
  | "UNSUPPORTED_DATE_RANGE";

export type ShiftMinuteSplitUnresolved = {
  status: "unresolved";
  code: ShiftMinuteSplitUnresolvedCode;
  message: string;
  diagnostics: {
    shiftId?: string;
    workerId?: string;
    clientId?: string;
    failedDateIso?: string;
    failedMinuteOfDay?: number;
    failedTimeFormatted?: string;
    underlyingPolicyCode?: string;
    details?: unknown;
    [key: string]: unknown;
  };
};

export type ShiftMinuteSplitResult =
  | ShiftMinuteSplitSuccess
  | ShiftMinuteSplitUnresolved;

/**
 * Calendar helpers
 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minuteOfDayToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${pad2(h)}:${pad2(min)}`;
}

function advanceCalendarDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const nextDate = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDate.getUTCFullYear();
  const nm = pad2(nextDate.getUTCMonth() + 1);
  const nd = pad2(nextDate.getUTCDate());
  return `${ny}-${nm}-${nd}`;
}

type InternalMinute = {
  minuteIndex: number;
  utcMs: number;
  dateIso: string;
  minuteOfDay: number;
  isBreak: boolean;
  breakWindowIndex?: number;
};

/**
 * Validates minute splitting invariants mathematically.
 */
export function validateMinuteSplittingInvariants(
  result: ShiftMinuteSplitSuccess
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Gross = Net + Break
  if (result.grossShiftMinutes !== result.netWorkMinutes + result.breakMinutes) {
    errors.push(
      `Invariant failed: grossShiftMinutes (${result.grossShiftMinutes}) != netWorkMinutes (${result.netWorkMinutes}) + breakMinutes (${result.breakMinutes})`
    );
  }

  // 2. Sum of work interval durations = netWorkMinutes
  const sumWorkIntervals = result.intervals.reduce(
    (acc, it) => acc + it.durationMinutes,
    0
  );
  if (sumWorkIntervals !== result.netWorkMinutes) {
    errors.push(
      `Invariant failed: sum of intervals (${sumWorkIntervals}) != netWorkMinutes (${result.netWorkMinutes})`
    );
  }

  // 3. Sum of break interval durations = breakMinutes (when physical break intervals are present)
  if (result.breakIntervals.length > 0) {
    const sumBreakIntervals = result.breakIntervals.reduce(
      (acc, it) => acc + it.durationMinutes,
      0
    );
    if (sumBreakIntervals !== result.breakMinutes) {
      errors.push(
        `Invariant failed: sum of breakIntervals (${sumBreakIntervals}) != breakMinutes (${result.breakMinutes})`
      );
    }
  }

  // 4. Base line item minutes = netWorkMinutes
  const baseItem = result.preparedLineItems.find((p) => p.itemCategory === "base");
  if (!baseItem || baseItem.minutes !== result.netWorkMinutes) {
    errors.push(
      `Invariant failed: base line item minutes (${baseItem?.minutes}) != netWorkMinutes (${result.netWorkMinutes})`
    );
  }

  // 5. Surcharge line items do not exceed netWorkMinutes
  for (const item of result.preparedLineItems) {
    if (item.itemCategory !== "base" && item.minutes > result.netWorkMinutes) {
      errors.push(
        `Invariant failed: surcharge item ${item.itemCategory} minutes (${item.minutes}) exceeds netWorkMinutes (${result.netWorkMinutes})`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Pure engine for partitioning shift minutes, validating breaks, and computing surcharges.
 */
export function splitShiftMinutes(
  input: ShiftMinuteSplitterInput
): ShiftMinuteSplitResult {
  const tz = input.timeZone || DEFAULT_TIMEZONE;

  // 1. Mandatory Identifier Validations
  if (!input.workerId || !input.workerId.trim()) {
    return {
      status: "unresolved",
      code: "MISSING_WORKER_ID",
      message:
        "Eindeutige Mitarbeiterkennung (workerId) fehlt. Zur Vermeidung von Verwechslungen namensgleicher Mitarbeiter ist workerId zwingend erforderlich.",
      diagnostics: { shiftId: input.shiftId },
    };
  }

  if (!input.clientId || !input.clientId.trim()) {
    return {
      status: "unresolved",
      code: "MISSING_CLIENT_ID",
      message: "Einrichtungskennung (clientId) fehlt.",
      diagnostics: { shiftId: input.shiftId, workerId: input.workerId },
    };
  }

  // Break Minutes validation: must be finite, safe non-negative integer if provided
  if (input.breakMinutes !== undefined && input.breakMinutes !== null) {
    if (
      typeof input.breakMinutes !== "number" ||
      !Number.isFinite(input.breakMinutes) ||
      isNaN(input.breakMinutes) ||
      !Number.isSafeInteger(input.breakMinutes) ||
      input.breakMinutes < 0
    ) {
      return {
        status: "unresolved",
        code: "INVALID_BREAK_DURATION",
        message: `Ungültige Pausendauer ("${input.breakMinutes}"). Pausendauer muss eine endliche, nicht-negative ganze Zahl sein.`,
        diagnostics: { shiftId: input.shiftId, breakMinutes: input.breakMinutes },
      };
    }
  }

  // Effective Hours validation: must be finite, non-negative number if provided
  if (
    input.effectiveWorkHoursRef &&
    input.effectiveWorkHoursRef.effectiveHours !== undefined &&
    input.effectiveWorkHoursRef.effectiveHours !== null
  ) {
    const eff = input.effectiveWorkHoursRef.effectiveHours;
    if (typeof eff !== "number" || !Number.isFinite(eff) || isNaN(eff) || eff < 0) {
      return {
        status: "unresolved",
        code: "INVALID_EFFECTIVE_HOURS",
        message: `Ungültige effektive Arbeitsstunden ("${eff}"). Muss eine endliche, nicht-negative Zahl sein.`,
        diagnostics: { shiftId: input.shiftId, effectiveHours: eff },
      };
    }
  }

  // 2. Frozen Policy Validations
  if (!input.policy) {
    return {
      status: "unresolved",
      code: "MISSING_POLICY",
      message:
        "Keine Zuschlagsrichtlinie (policy) übergeben. Schätzungen oder Standardannahmen sind unzulässig.",
      diagnostics: { shiftId: input.shiftId, clientId: input.clientId },
    };
  }

  if (input.policy.isFrozen !== true) {
    return {
      status: "unresolved",
      code: "POLICY_NOT_FROZEN",
      message:
        "Die übergebene Zuschlagsrichtlinie ist nicht eingefroren (isFrozen !== true). Für die Abrechnung müssen unveränderliche, eingefrorene Richtlinien verwendet werden.",
      diagnostics: {
        shiftId: input.shiftId,
        policyId: input.policy.policyId,
        policyVersion: input.policy.policyVersion,
      },
    };
  }

  if (input.policy.clientId !== input.clientId) {
    return {
      status: "unresolved",
      code: "CLIENT_POLICY_MISMATCH",
      message: `Die Zuschlagsrichtlinie gehört zu Mandant "${input.policy.clientId}", die Schicht jedoch zu "${input.clientId}".`,
      diagnostics: {
        shiftId: input.shiftId,
        inputClientId: input.clientId,
        policyClientId: input.policy.clientId,
      },
    };
  }

  // Verify that the terms of the frozen policy strictly match its frozenHash (anti-tampering check)
  const calculatedPolicyHash = computePolicyCanonicalHash({
    clientId: input.policy.clientId,
    clientContractId: input.policy.clientContractId,
    policyVersion: input.policy.policyVersion,
    federalState: input.policy.federalState,
    municipality: input.policy.municipality,
    districtLocality: input.policy.districtLocality,
    surchargeSat: input.policy.surcharges.sat,
    surchargeSun: input.policy.surcharges.sun,
    surchargeHoliday: input.policy.surcharges.holiday,
    surchargeNight: input.policy.surcharges.night,
    nightStart: input.policy.nightWindow.start,
    nightEnd: input.policy.nightWindow.end,
    combinationRule: input.policy.combinationRule,
    sourceType: input.policy.sourceType,
    sourceReference: input.policy.sourceReference,
    effectiveFrom: input.policy.effectiveFrom,
    effectiveTo: input.policy.effectiveTo,
  });

  if (input.policy.frozenHash !== calculatedPolicyHash) {
    return {
      status: "unresolved",
      code: "POLICY_UNRESOLVED",
      message: `Die Prüfsumme der eingefrorenen Richtlinie stimmt nicht mit ihren Bedingungen überein (Erwartet: ${calculatedPolicyHash}, Hinterlegt: ${input.policy.frozenHash || "null"}).`,
      diagnostics: {
        shiftId: input.shiftId,
        clientId: input.clientId,
        policyId: input.policy.policyId,
        underlyingPolicyCode: "TAMPERED_FROZEN_POLICY",
        expectedHash: calculatedPolicyHash,
        actualHash: input.policy.frozenHash,
      },
    };
  }

  // 3. Effective Work Hours Reference Validation
  if (
    !input.effectiveWorkHoursRef ||
    !input.effectiveWorkHoursRef.effectiveVersion ||
    !input.effectiveWorkHoursRef.effectiveVersion.trim()
  ) {
    return {
      status: "unresolved",
      code: "MISSING_EFFECTIVE_HOURS_VERSION",
      message:
        "Gültiger Versions-Token der effektiven Arbeitsstunden (effectiveVersion aus Phase 3c) fehlt.",
      diagnostics: { shiftId: input.shiftId },
    };
  }

  // 4. Resolve Date & Times into Wall Clock Intervals
  let startDayIso: string;
  let startH: number;
  let startMin: number;
  let endH: number;
  let endMin: number;
  let explicitEndDayIso: string | null = null;
  let startUtcMs = 0;
  let endUtcMs = 0;
  let isExplicitTimestampInput = false;

  if (input.startDateTime && input.endDateTime) {
    // Explicit Date / ISO string input
    isExplicitTimestampInput = true;

    // Validate explicit timezone offset if string
    if (typeof input.startDateTime === "string") {
      const sTrim = input.startDateTime.trim();
      if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(sTrim)) {
        return {
          status: "unresolved",
          code: "INVALID_TIME_FORMAT",
          message:
            "startDateTime muss eine explizite Zeitzonenangabe oder einen UTC-Offset (z.B. 'Z' oder '+01:00') besitzen.",
          diagnostics: { shiftId: input.shiftId, startDateTime: input.startDateTime },
        };
      }
    }
    if (typeof input.endDateTime === "string") {
      const eTrim = input.endDateTime.trim();
      if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(eTrim)) {
        return {
          status: "unresolved",
          code: "INVALID_TIME_FORMAT",
          message:
            "endDateTime muss eine explizite Zeitzonenangabe oder einen UTC-Offset (z.B. 'Z' oder '+01:00') besitzen.",
          diagnostics: { shiftId: input.shiftId, endDateTime: input.endDateTime },
        };
      }
    }

    const sDate =
      input.startDateTime instanceof Date
        ? input.startDateTime
        : new Date(input.startDateTime);
    const eDate =
      input.endDateTime instanceof Date
        ? input.endDateTime
        : new Date(input.endDateTime);

    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime())) {
      return {
        status: "unresolved",
        code: "INVALID_TIME_FORMAT",
        message: "Ungültige Zeitstempel in startDateTime oder endDateTime.",
        diagnostics: {
          shiftId: input.shiftId,
          startDateTime: String(input.startDateTime),
          endDateTime: String(input.endDateTime),
        },
      };
    }

    // Require minute precision (non-zero seconds or milliseconds rejected)
    if (
      sDate.getUTCSeconds() !== 0 ||
      sDate.getUTCMilliseconds() !== 0 ||
      eDate.getUTCSeconds() !== 0 ||
      eDate.getUTCMilliseconds() !== 0
    ) {
      return {
        status: "unresolved",
        code: "INVALID_TIME_FORMAT",
        message:
          "Arbeitszeiten müssen minutengenau angegeben werden (Sekunden und Millisekunden müssen 0 sein).",
        diagnostics: {
          shiftId: input.shiftId,
          startDateTime: String(input.startDateTime),
          endDateTime: String(input.endDateTime),
        },
      };
    }

    startUtcMs = sDate.getTime();
    endUtcMs = eDate.getTime();

    if (endUtcMs <= startUtcMs) {
      return {
        status: "unresolved",
        code: "INVALID_TIME_INTERVAL",
        message:
          "Endzeit liegt nicht nach der Startzeit der Schicht (endDateTime <= startDateTime).",
        diagnostics: { shiftId: input.shiftId, startUtcMs, endUtcMs },
      };
    }

    const sFmt = formatInTimeZone(sDate, tz, "yyyy-MM-dd HH:mm");
    const eFmt = formatInTimeZone(eDate, tz, "yyyy-MM-dd HH:mm");
    startDayIso = sFmt.slice(0, 10);
    startH = Number(sFmt.slice(11, 13));
    startMin = Number(sFmt.slice(14, 16));
    explicitEndDayIso = eFmt.slice(0, 10);
    endH = Number(eFmt.slice(11, 13));
    endMin = Number(eFmt.slice(14, 16));
  } else if (input.shiftDate && input.startTime && input.endTime) {
    if (!isValidTimeString(input.startTime) || !isValidTimeString(input.endTime)) {
      return {
        status: "unresolved",
        code: "INVALID_TIME_FORMAT",
        message: `Ungültiges Uhrzeitformat in startTime ("${input.startTime}") oder endTime ("${input.endTime}"). Erwartet wird "HH:mm".`,
        diagnostics: {
          shiftId: input.shiftId,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      };
    }

    if (input.shiftDate instanceof Date) {
      if (isNaN(input.shiftDate.getTime())) {
        return {
          status: "unresolved",
          code: "INVALID_TIME_FORMAT",
          message: "Ungültiges shiftDate Datumsobjekt.",
          diagnostics: { shiftId: input.shiftId },
        };
      }
      startDayIso = input.shiftDate.toISOString().slice(0, 10);
    } else {
      startDayIso = String(input.shiftDate).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDayIso)) {
        return {
          status: "unresolved",
          code: "INVALID_TIME_FORMAT",
          message: `Ungültiges Datum in shiftDate ("${input.shiftDate}"). Erwartet wird YYYY-MM-DD.`,
          diagnostics: { shiftId: input.shiftId, shiftDate: input.shiftDate },
        };
      }
    }

    [startH, startMin] = input.startTime.split(":").map(Number);
    [endH, endMin] = input.endTime.split(":").map(Number);

    const [y, m, d] = startDayIso.split("-").map(Number);
    const startWallRes = resolveWallTimeToUtc(y, m, d, startH, startMin, tz);
    if (startWallRes.warningType === "DST_GAP") {
      return {
        status: "unresolved",
        code: "DST_GAP",
        message: `Die Startzeit ${startDayIso} ${input.startTime} existiert nicht in der Zeitzone ${tz} (Sommerzeit-Umstellungslücke).`,
        diagnostics: {
          shiftId: input.shiftId,
          failedDateIso: startDayIso,
          failedTimeFormatted: input.startTime,
        },
      };
    }
    if (startWallRes.warningType === "DST_AMBIGUOUS") {
      return {
        status: "unresolved",
        code: "DST_AMBIGUOUS",
        message: `Die Startzeit ${startDayIso} ${input.startTime} ist in der Zeitzone ${tz} mehrdeutig (tritt während der Winterzeit-Umstellung doppelt auf).`,
        diagnostics: {
          shiftId: input.shiftId,
          failedDateIso: startDayIso,
          failedTimeFormatted: input.startTime,
        },
      };
    }

    startUtcMs = startWallRes.utcMs;

    const startTotalMin = startH * 60 + startMin;
    const endTotalMin = endH * 60 + endMin;
    const isOvernight = endTotalMin <= startTotalMin;

    let endYear = y;
    let endMonth = m;
    let endDay = d;
    if (isOvernight) {
      const nextD = new Date(Date.UTC(y, m - 1, d + 1));
      endYear = nextD.getUTCFullYear();
      endMonth = nextD.getUTCMonth() + 1;
      endDay = nextD.getUTCDate();
      explicitEndDayIso = `${endYear}-${pad2(endMonth)}-${pad2(endDay)}`;
    } else {
      explicitEndDayIso = startDayIso;
    }

    const endWallRes = resolveWallTimeToUtc(
      endYear,
      endMonth,
      endDay,
      endH,
      endMin,
      tz
    );
    if (endWallRes.warningType === "DST_GAP") {
      return {
        status: "unresolved",
        code: "DST_GAP",
        message: `Die Endzeit ${explicitEndDayIso} ${input.endTime} existiert nicht in der Zeitzone ${tz} (Sommerzeit-Umstellungslücke).`,
        diagnostics: {
          shiftId: input.shiftId,
          failedDateIso: explicitEndDayIso,
          failedTimeFormatted: input.endTime,
        },
      };
    }
    if (endWallRes.warningType === "DST_AMBIGUOUS") {
      return {
        status: "unresolved",
        code: "DST_AMBIGUOUS",
        message: `Die Endzeit ${explicitEndDayIso} ${input.endTime} ist in der Zeitzone ${tz} mehrdeutig (tritt während der Winterzeit-Umstellung doppelt auf).`,
        diagnostics: {
          shiftId: input.shiftId,
          failedDateIso: explicitEndDayIso,
          failedTimeFormatted: input.endTime,
        },
      };
    }

    endUtcMs = endWallRes.utcMs;

    // Check for DST transition traversed during shift in wall clock mode
    const physicalMinutes = Math.round((endUtcMs - startUtcMs) / 60000);
    const wallClockMinutes = isOvernight
      ? 1440 - startTotalMin + endTotalMin
      : endTotalMin - startTotalMin;

    if (physicalMinutes !== wallClockMinutes) {
      if (physicalMinutes < wallClockMinutes) {
        return {
          status: "unresolved",
          code: "DST_GAP",
          message: `Die Schicht durchquert die Sommerzeit-Lücke in ${tz}. Lokale Uhrzeiten können nicht ohne explizite Zeitstempel bestimmt werden.`,
          diagnostics: {
            shiftId: input.shiftId,
            physicalMinutes,
            wallClockMinutes,
          },
        };
      } else {
        return {
          status: "unresolved",
          code: "DST_AMBIGUOUS",
          message: `Die Schicht durchquert die Winterzeit-Doppelstunde in ${tz}. Lokale Uhrzeiten können nicht ohne explizite Zeitstempel bestimmt werden.`,
          diagnostics: {
            shiftId: input.shiftId,
            physicalMinutes,
            wallClockMinutes,
          },
        };
      }
    }
  } else {
    return {
      status: "unresolved",
      code: "INVALID_TIME_INTERVAL",
      message:
        "Weder gültige startDateTime/endDateTime noch shiftDate mit startTime/endTime übergeben.",
      diagnostics: { shiftId: input.shiftId },
    };
  }

  // 5. Generate Minute Grid
  const minutes: InternalMinute[] = [];

  if (isExplicitTimestampInput) {
    // Explicit timestamps: strictly iterate physical UTC minutes (DST-safe)
    const physicalMinutes = Math.round((endUtcMs - startUtcMs) / 60000);
    for (let i = 0; i < physicalMinutes; i++) {
      const curUtcMs = startUtcMs + i * 60000;
      const curFmt = formatInTimeZone(curUtcMs, tz, "yyyy-MM-dd HH:mm");
      const dateIso = curFmt.slice(0, 10);
      const hour = Number(curFmt.slice(11, 13));
      const min = Number(curFmt.slice(14, 16));
      minutes.push({
        minuteIndex: i,
        utcMs: curUtcMs,
        dateIso,
        minuteOfDay: hour * 60 + min,
        isBreak: false,
      });
    }
  } else {
    // Wall clock shiftDate + startTime/endTime: iterate wall clock minutes
    let currDateIso = startDayIso;
    let currMinuteOfDay = startH * 60 + startMin;
    const targetEndMinuteOfDay = endH * 60 + endMin;
    const targetEndDateIso = explicitEndDayIso || startDayIso;

    let minuteIdx = 0;
    while (true) {
      if (currDateIso === targetEndDateIso && currMinuteOfDay === targetEndMinuteOfDay) {
        break;
      }
      const [y, m, d] = currDateIso.split("-").map(Number);
      const h = Math.floor(currMinuteOfDay / 60);
      const min = currMinuteOfDay % 60;
      const wallRes = resolveWallTimeToUtc(y, m, d, h, min, tz);

      minutes.push({
        minuteIndex: minuteIdx++,
        utcMs: wallRes.utcMs,
        dateIso: currDateIso,
        minuteOfDay: currMinuteOfDay,
        isBreak: false,
      });

      currMinuteOfDay++;
      if (currMinuteOfDay === 1440) {
        currMinuteOfDay = 0;
        currDateIso = advanceCalendarDay(currDateIso);
      }
    }
  }

  const grossShiftMinutes = minutes.length;
  if (grossShiftMinutes === 0) {
    return {
      status: "unresolved",
      code: "INVALID_TIME_INTERVAL",
      message: "Schichtdauer beträgt 0 Minuten.",
      diagnostics: { shiftId: input.shiftId },
    };
  }

  // 6. Handle Breaks
  let totalBreakMinutes = 0;
  const breakIntervals: ShiftBreakInterval[] = [];

  if (input.breakWindows && input.breakWindows.length > 0) {
    // A. Explicit Break Windows
    for (let bwIdx = 0; bwIdx < input.breakWindows.length; bwIdx++) {
      const bw = input.breakWindows[bwIdx];

      const isStartExplicit =
        bw.start instanceof Date ||
        (typeof bw.start === "string" && /(Z|[+-]\d{2}(:?\d{2})?)$/.test(bw.start.trim()));
      const isEndExplicit =
        bw.end instanceof Date ||
        (typeof bw.end === "string" && /(Z|[+-]\d{2}(:?\d{2})?)$/.test(bw.end.trim()));

      if (isStartExplicit || isEndExplicit || isExplicitTimestampInput) {
        if (!isStartExplicit || !isEndExplicit) {
          return {
            status: "unresolved",
            code: isExplicitTimestampInput ? "TIME_AMBIGUOUS_OR_INVALID" : "INVALID_TIME_FORMAT",
            message:
              "In einer Schicht mit expliziten UTC-Zeitstempeln müssen Pausenfenster für Start und Ende ebenfalls mit expliziter Zeitzone angegeben werden.",
            diagnostics: { shiftId: input.shiftId, breakWindow: bw },
          };
        }

        const sD = bw.start instanceof Date ? bw.start : new Date(bw.start);
        const eD = bw.end instanceof Date ? bw.end : new Date(bw.end);
        if (isNaN(sD.getTime()) || isNaN(eD.getTime())) {
          return {
            status: "unresolved",
            code: "INVALID_TIME_FORMAT",
            message: `Ungültiges Zeitformat im Pausenfenster Index ${bwIdx}.`,
            diagnostics: { shiftId: input.shiftId, breakWindow: bw },
          };
        }

        // Minute precision check (seconds and milliseconds must be 0)
        if (
          sD.getUTCSeconds() !== 0 ||
          sD.getUTCMilliseconds() !== 0 ||
          eD.getUTCSeconds() !== 0 ||
          eD.getUTCMilliseconds() !== 0
        ) {
          return {
            status: "unresolved",
            code: "INVALID_TIME_FORMAT",
            message:
              "Pausenzeiten müssen minutengenau angegeben werden (Sekunden und Millisekunden müssen 0 sein).",
            diagnostics: { shiftId: input.shiftId, breakWindow: bw },
          };
        }

        const bwStartUtcMs = sD.getTime();
        const bwEndUtcMs = eD.getTime();

        if (bwEndUtcMs <= bwStartUtcMs) {
          return {
            status: "unresolved",
            code: "INVALID_TIME_INTERVAL",
            message: "Pausenende muss nach Pausenbeginn liegen.",
            diagnostics: { shiftId: input.shiftId, breakWindow: bw },
          };
        }

        const bPhysicalMinutes = Math.round((bwEndUtcMs - bwStartUtcMs) / 60000);
        let matchedCount = 0;

        for (let k = 0; k < bPhysicalMinutes; k++) {
          const curMUtc = bwStartUtcMs + k * 60000;
          const minObj = minutes.find((m) => m.utcMs === curMUtc);
          if (!minObj) {
            return {
              status: "unresolved",
              code: "BREAK_WINDOW_OUTSIDE_SHIFT",
              message: `Pausenfenster Minute ${new Date(curMUtc).toISOString()} liegt außerhalb der Schichtarbeitszeit.`,
              diagnostics: { shiftId: input.shiftId, breakWindow: bw, curUtc: curMUtc },
            };
          }
          if (minObj.isBreak) {
            return {
              status: "unresolved",
              code: "OVERLAPPING_BREAK_WINDOWS",
              message: `Pausenfenster überschneiden sich bei ${new Date(curMUtc).toISOString()}.`,
              diagnostics: { shiftId: input.shiftId, breakWindow: bw, curUtc: curMUtc },
            };
          }
          minObj.isBreak = true;
          minObj.breakWindowIndex = bwIdx;
          matchedCount++;
        }

        totalBreakMinutes += matchedCount;
      } else {
        // Wall clock time strings ("HH:mm")
        if (typeof bw.start !== "string" || !isValidTimeString(bw.start) || typeof bw.end !== "string" || !isValidTimeString(bw.end)) {
          return {
            status: "unresolved",
            code: "INVALID_TIME_FORMAT",
            message: `Ungültiges Uhrzeitformat im Pausenfenster Index ${bwIdx}. Erwartet wird "HH:mm".`,
            diagnostics: { shiftId: input.shiftId, breakWindow: bw },
          };
        }

        const bStartIso = bw.dateIso || startDayIso;
        let bEndIso = bw.dateIso || startDayIso;
        const [bh1, bm1] = bw.start.split(":").map(Number);
        const [bh2, bm2] = bw.end.split(":").map(Number);
        const bStartMod = bh1 * 60 + bm1;
        const bEndMod = bh2 * 60 + bm2;
        if (bEndMod < bStartMod) {
          bEndIso = advanceCalendarDay(bStartIso);
        }

        let curBDate = bStartIso;
        let curBMod = bStartMod;
        let matchedCount = 0;

        while (true) {
          if (curBDate === bEndIso && curBMod === bEndMod) {
            break;
          }
          const minObj = minutes.find(
            (m) => m.dateIso === curBDate && m.minuteOfDay === curBMod
          );
          if (!minObj) {
            return {
              status: "unresolved",
              code: "BREAK_WINDOW_OUTSIDE_SHIFT",
              message: `Pausenfenster ${curBDate} ${minuteOfDayToHHMM(curBMod)} liegt außerhalb der Schichtarbeitszeit.`,
              diagnostics: { shiftId: input.shiftId, breakWindow: bw },
            };
          }
          if (minObj.isBreak) {
            return {
              status: "unresolved",
              code: "OVERLAPPING_BREAK_WINDOWS",
              message: `Pausenfenster überschneiden sich bei ${curBDate} ${minuteOfDayToHHMM(curBMod)}.`,
              diagnostics: { shiftId: input.shiftId, breakWindow: bw },
            };
          }
          minObj.isBreak = true;
          minObj.breakWindowIndex = bwIdx;
          matchedCount++;

          curBMod++;
          if (curBMod === 1440) {
            curBMod = 0;
            curBDate = advanceCalendarDay(curBDate);
          }
        }

        totalBreakMinutes += matchedCount;
      }
    }
  } else if (input.breakMinutes && input.breakMinutes > 0) {
    // B. Duration-Only Break (no timestamps)
    totalBreakMinutes = input.breakMinutes;

    if (totalBreakMinutes >= grossShiftMinutes) {
      return {
        status: "unresolved",
        code: "BREAK_EXCEEDS_SHIFT_DURATION",
        message: `Pausendauer (${totalBreakMinutes} Min.) darf die Schichtdauer (${grossShiftMinutes} Min.) nicht erreichen oder überschreiten.`,
        diagnostics: {
          shiftId: input.shiftId,
          grossShiftMinutes,
          breakMinutes: totalBreakMinutes,
        },
      };
    }

    // Evaluate all minutes first to check surcharge categories across shift
    const evaluatedAll = minutes.map((m) =>
      evaluateMinuteSurcharges(m.dateIso, m.minuteOfDay, input.policy)
    );

    for (let i = 0; i < evaluatedAll.length; i++) {
      const ev = evaluatedAll[i];
      if (ev.status === "policy_unresolved") {
        return {
          status: "unresolved",
          code: "POLICY_UNRESOLVED",
          message: ev.message,
          diagnostics: {
            shiftId: input.shiftId,
            workerId: input.workerId,
            clientId: input.clientId,
            failedDateIso: minutes[i].dateIso,
            failedMinuteOfDay: minutes[i].minuteOfDay,
            failedTimeFormatted: minuteOfDayToHHMM(minutes[i].minuteOfDay),
            underlyingPolicyCode: ev.code,
            details: ev.diagnostics,
          },
        };
      }
    }

    // Check distinct rate categories
    const distinctProfiles = new Set(
      evaluatedAll.map((ev) => {
        if (ev.status !== "resolved") return "";
        return `${ev.applicableComponents.slice().sort().join("+")}|${ev.rateMultiplier}`;
      })
    );

    // Contractual proportional break allocation requires explicit documented source reference
    if (input.contractualBreakAllocationRule === "proportional") {
      if (
        !input.breakAllocationSourceReference ||
        !input.breakAllocationSourceReference.trim()
      ) {
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message:
            "Für eine proportionale Pausenaufteilung ist eine dokumentierte Quelle (breakAllocationSourceReference) zwingend erforderlich.",
          diagnostics: {
            shiftId: input.shiftId,
            contractualBreakAllocationRule: input.contractualBreakAllocationRule,
            breakAllocationSourceReference: input.breakAllocationSourceReference,
          },
        };
      }

      // Check 1: Policy must be grounded in an actual contract
      if (input.policy.sourceType !== "contract") {
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message:
            "Eine proportionale Pausenaufteilung setzt eine vertragliche Richtlinie (sourceType: 'contract') voraus. Die hinterlegte Richtlinie basiert nicht auf einem Vertrag.",
          diagnostics: {
            shiftId: input.shiftId,
            clientId: input.clientId,
            policySourceType: input.policy.sourceType,
            breakAllocationSourceReference: input.breakAllocationSourceReference,
          },
        };
      }

      const refTrim = input.breakAllocationSourceReference.trim();
      const refLower = refTrim.toLowerCase();
      const contractIdLower = (input.policy.clientContractId || "").trim().toLowerCase();
      const policySourceRefLower = (input.policy.sourceReference || "").trim().toLowerCase();

      // Check 2: Reject references to foreign clients
      const foreignClientRegex = /client[-_]?[0-9a-zA-Z]+/i;
      const foreignMatch = refTrim.match(foreignClientRegex);
      if (foreignMatch && foreignMatch[0].toLowerCase() !== input.clientId.toLowerCase()) {
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message: `Der angegebene Pausen-Quellverweis ("${refTrim}") bezieht sich auf einen fremden Mandanten (${foreignMatch[0]}) und nicht auf "${input.clientId}".`,
          diagnostics: {
            shiftId: input.shiftId,
            clientId: input.clientId,
            breakAllocationSourceReference: refTrim,
            foreignMatch: foreignMatch[0],
          },
        };
      }

      // Check 3: Reject arbitrary or foreign contract references
      const matchesContractId = contractIdLower.length > 0 && refLower.includes(contractIdLower);
      const matchesSourceRef = policySourceRefLower.length > 0 && refLower.includes(policySourceRefLower);

      if (!matchesContractId && !matchesSourceRef) {
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message: `Der angegebene Pausen-Quellverweis ("${refTrim}") ist keinem verifizierten Vertrag der Einrichtung zugeordnet. Erwartet wird ein Bezug auf den Mandantenvertrag ("${input.policy.clientContractId || input.policy.sourceReference}").`,
          diagnostics: {
            shiftId: input.shiftId,
            clientId: input.clientId,
            expectedContractId: input.policy.clientContractId,
            expectedSourceReference: input.policy.sourceReference,
            breakAllocationSourceReference: refTrim,
          },
        };
      }
    }

    if (distinctProfiles.size > 1) {
      // Crosses surcharge boundaries!
      if (input.contractualBreakAllocationRule === "proportional") {
        // Check 4: Across intersecting surcharge boundaries, mere free text referencing the contract ID
        // does NOT prove that the contract actually contains a proportional break allocation clause.
        // A verified contract break clause record (verifiedBreakClause) is strictly required.
        const vb = input.verifiedBreakClause;
        if (!vb) {
          return {
            status: "unresolved",
            code: "UNRESOLVED_BREAK_ALLOCATION",
            message: `Eine proportionale Pausenaufteilung über unterschiedliche Zuschlagskategorien hinweg erfordert einen verifizierten vertraglichen Nachweis (verifiedBreakClause). Der Freitext-Quellverweis ("${input.breakAllocationSourceReference?.trim()}") belegt ohne verifizierten Nachweis nicht das Bestehen einer vertraglichen Pausenregelung; die Abrechnung bleibt bis zur vertraglichen Erfassung ungelöst.`,
            diagnostics: {
              shiftId: input.shiftId,
              clientId: input.clientId,
              contractualBreakAllocationRule: input.contractualBreakAllocationRule,
              breakAllocationSourceReference: input.breakAllocationSourceReference,
              reason: "MISSING_VERIFIED_BREAK_CLAUSE",
            },
          };
        }

        const matchesVbClient = vb.clientId.toLowerCase() === input.clientId.toLowerCase();
        const matchesVbContract =
          vb.clientContractId.toLowerCase() === (input.policy.clientContractId || "").toLowerCase();
        const matchesVbVersion = vb.policyVersion === input.policy.policyVersion;
        const matchesVbRule = vb.rule === "proportional";
        const hasVbClauseRef = Boolean(vb.clauseReference && vb.clauseReference.trim());
        const hasVbVerifiedBy = Boolean(vb.verifiedBy && vb.verifiedBy.trim());
        const hasVbVerifiedAt = Boolean(vb.verifiedAt && !isNaN(Date.parse(vb.verifiedAt)));

        if (
          !matchesVbClient ||
          !matchesVbContract ||
          !matchesVbVersion ||
          !matchesVbRule ||
          !hasVbClauseRef ||
          !hasVbVerifiedBy ||
          !hasVbVerifiedAt
        ) {
          return {
            status: "unresolved",
            code: "UNRESOLVED_BREAK_ALLOCATION",
            message: `Der hinterlegte vertragliche Pausennachweis stimmt nicht mit dem Mandanten, Vertrag oder der Richtlinienversion überein.`,
            diagnostics: {
              shiftId: input.shiftId,
              clientId: input.clientId,
              expectedClientContractId: input.policy.clientContractId,
              expectedPolicyVersion: input.policy.policyVersion,
              verifiedBreakClause: vb,
            },
          };
        }

        // Proportional allocation via Largest Remainder Method (Hamilton Method)
        const profileCounts = new Map<string, number>();
        for (const ev of evaluatedAll) {
          if (ev.status !== "resolved") continue;
          const key = `${ev.applicableComponents.slice().sort().join("+")}|${ev.rateMultiplier}`;
          profileCounts.set(key, (profileCounts.get(key) || 0) + 1);
        }

        type ProfileAllocation = {
          key: string;
          count: number;
          exactQuota: number;
          baseQuota: number;
          remainder: number;
          allocation: number;
        };

        const profileList: ProfileAllocation[] = [];
        let allocatedBaseSum = 0;

        for (const [key, count] of profileCounts.entries()) {
          const exactQuota = (count * totalBreakMinutes) / grossShiftMinutes;
          const baseQuota = Math.floor(exactQuota);
          const remainder = exactQuota - baseQuota;
          profileList.push({
            key,
            count,
            exactQuota,
            baseQuota,
            remainder,
            allocation: baseQuota,
          });
          allocatedBaseSum += baseQuota;
        }

        let deficit = totalBreakMinutes - allocatedBaseSum;

        // Sort descending by remainder, tie-break deterministically by key
        profileList.sort((a, b) => {
          if (b.remainder !== a.remainder) {
            return b.remainder - a.remainder;
          }
          return a.key.localeCompare(b.key);
        });

        // Distribute remaining break minutes to highest remainders with capacity
        for (const p of profileList) {
          if (deficit === 0) break;
          if (p.allocation < p.count) {
            p.allocation++;
            deficit--;
          }
        }

        // Failsafe in case any profile was saturated
        if (deficit > 0) {
          for (const p of profileList) {
            if (deficit === 0) break;
            const canAdd = p.count - p.allocation;
            const add = Math.min(deficit, canAdd);
            p.allocation += add;
            deficit -= add;
          }
        }

        const breakDeductionPerProfile = new Map<string, number>();
        for (const p of profileList) {
          breakDeductionPerProfile.set(p.key, p.allocation);
        }

        // Apply deduction to minutes from the end of each category cluster
        const deductedCounter = new Map<string, number>();
        for (let i = minutes.length - 1; i >= 0; i--) {
          const ev = evaluatedAll[i];
          if (ev.status !== "resolved") continue;
          const key = `${ev.applicableComponents.slice().sort().join("+")}|${ev.rateMultiplier}`;
          const quota = breakDeductionPerProfile.get(key) || 0;
          const currentDeducted = deductedCounter.get(key) || 0;
          if (currentDeducted < quota) {
            minutes[i].isBreak = true;
            deductedCounter.set(key, currentDeducted + 1);
          }
        }
      } else {
        // Ambiguous break placement across categories without contractual rule
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message: `Die Pause (${totalBreakMinutes} Min.) hat keine dokumentierte zeitliche Lage, und die Schicht überschreitet Zuschlagskategorie-Grenzen (${Array.from(distinctProfiles).join(", ")}). Eine automatische Zuweisung zu einer teureren oder günstigeren Kategorie ohne vertragliche Regel ist unzulässig.`,
          diagnostics: {
            shiftId: input.shiftId,
            breakMinutes: totalBreakMinutes,
            distinctSurchargeProfiles: Array.from(distinctProfiles),
            contractualBreakAllocationRule:
              input.contractualBreakAllocationRule || null,
          },
        };
      }
    } else {
      // Entire shift falls into a single uniform surcharge category!
      // Deducting break minutes from the tail or middle is financially completely identical.
      // We flag the last totalBreakMinutes of the shift as break minutes.
      for (let i = grossShiftMinutes - totalBreakMinutes; i < grossShiftMinutes; i++) {
        minutes[i].isBreak = true;
      }
    }
  }

  // Build Break Intervals ONLY when physical break windows were provided (do not synthesize for accounting deductions)
  if (input.breakWindows && input.breakWindows.length > 0) {
    let curBreakStart: InternalMinute | null = null;
    let breakIntIdx = 1;

    for (let i = 0; i < minutes.length; i++) {
      const m = minutes[i];
      if (m.isBreak) {
        if (!curBreakStart) {
          curBreakStart = m;
        }
      } else {
        if (curBreakStart) {
          const lastM = minutes[i - 1];
          const startUtc = new Date(curBreakStart.utcMs).toISOString();
          const endUtc = new Date(lastM.utcMs + 60000).toISOString();
          breakIntervals.push({
            intervalIndex: breakIntIdx++,
            dateIso: curBreakStart.dateIso,
            startMinuteOfDay: curBreakStart.minuteOfDay,
            endMinuteOfDay: lastM.minuteOfDay + 1,
            startTime: isExplicitTimestampInput
              ? formatInTimeZone(curBreakStart.utcMs, tz, "HH:mmxxx")
              : minuteOfDayToHHMM(curBreakStart.minuteOfDay),
            endTime: isExplicitTimestampInput
              ? formatInTimeZone(lastM.utcMs + 60000, tz, "HH:mmxxx")
              : minuteOfDayToHHMM(lastM.minuteOfDay + 1),
            startDateTime: startUtc,
            endDateTime: endUtc,
            durationMinutes: i - curBreakStart.minuteIndex,
          });
          curBreakStart = null;
        }
      }
    }
    if (curBreakStart) {
      const lastM = minutes[minutes.length - 1];
      const startUtc = new Date(curBreakStart.utcMs).toISOString();
      const endUtc = new Date(lastM.utcMs + 60000).toISOString();
      breakIntervals.push({
        intervalIndex: breakIntIdx++,
        dateIso: curBreakStart.dateIso,
        startMinuteOfDay: curBreakStart.minuteOfDay,
        endMinuteOfDay: lastM.minuteOfDay + 1,
        startTime: isExplicitTimestampInput
          ? formatInTimeZone(curBreakStart.utcMs, tz, "HH:mmxxx")
          : minuteOfDayToHHMM(curBreakStart.minuteOfDay),
        endTime: isExplicitTimestampInput
          ? formatInTimeZone(lastM.utcMs + 60000, tz, "HH:mmxxx")
          : minuteOfDayToHHMM(lastM.minuteOfDay + 1),
        startDateTime: startUtc,
        endDateTime: endUtc,
        durationMinutes: minutes.length - curBreakStart.minuteIndex,
      });
    }
  }

  // 7. Evaluate Working Minutes & Discretize Intervals
  const workMinutes = minutes.filter((m) => !m.isBreak);
  const netWorkMinutes = workMinutes.length;

  if (netWorkMinutes === 0) {
    return {
      status: "unresolved",
      code: "INVALID_TIME_INTERVAL",
      message: "Nettoarbeitszeit nach Pausenabzug beträgt 0 Minuten.",
      diagnostics: { shiftId: input.shiftId, grossShiftMinutes, totalBreakMinutes },
    };
  }

  // Reconcile calculated netWorkMinutes with confirmed effective hours (DIN 1333 commercial hundredths comparison)
  const calculatedHundredths = Math.round((netWorkMinutes * 100) / 60);
  const confirmedHundredths = Math.round(
    input.effectiveWorkHoursRef.effectiveHours * 100
  );
  if (calculatedHundredths !== confirmedHundredths) {
    return {
      status: "unresolved",
      code: "EFFECTIVE_HOURS_MISMATCH",
      message: `Berechnete Nettoarbeitszeit (${netWorkMinutes} Min. = ${(netWorkMinutes / 60).toFixed(2)} Std.) weicht von den bestätigten Arbeitsstunden (${input.effectiveWorkHoursRef.effectiveHours.toFixed(2)} Std.) ab.`,
      diagnostics: {
        shiftId: input.shiftId,
        calculatedNetWorkMinutes: netWorkMinutes,
        calculatedHundredths,
        confirmedEffectiveHours: input.effectiveWorkHoursRef.effectiveHours,
        confirmedHundredths,
        effectiveHoursVersion: input.effectiveWorkHoursRef.effectiveVersion,
        effectiveHoursSource: input.effectiveWorkHoursRef.source,
      },
    };
  }

function getEffectiveSurchargeComponents(
  applicableComponents: SurchargeComponent[],
  isNight: boolean,
  policy: ResolvedSurchargePolicySuccess
): SurchargeComponent[] {
  if (policy.combinationRule === "cumulative") {
    return applicableComponents;
  }

  // highest_non_night_plus_night
  const effective: SurchargeComponent[] = [];
  const nonNight = applicableComponents.filter((c) => c !== "night");

  if (nonNight.length === 1) {
    effective.push(nonNight[0]);
  } else if (nonNight.length > 1) {
    let maxRate = -1;
    let bestComp: SurchargeComponent = nonNight[0];
    for (const c of nonNight) {
      const rate = policy.surcharges[c];
      if (rate > maxRate) {
        maxRate = rate;
        bestComp = c;
      }
    }
    effective.push(bestComp);
  }

  if (isNight) {
    effective.push("night");
  }

  return effective;
}

  type EvaluatedMinute = {
    m: InternalMinute;
    isSaturday: boolean;
    isSunday: boolean;
    isHoliday: boolean;
    holidayName?: string;
    isNight: boolean;
    applicableComponents: SurchargeComponent[];
    effectiveSurchargeFraction: number;
    rateMultiplier: number;
    breakdownDescriptionDE: string;
  };

  const evaluatedWorkMinutes: EvaluatedMinute[] = [];
  for (const m of workMinutes) {
    const ev = evaluateMinuteSurcharges(m.dateIso, m.minuteOfDay, input.policy);
    if (ev.status === "policy_unresolved") {
      return {
        status: "unresolved",
        code: "POLICY_UNRESOLVED",
        message: ev.message,
        diagnostics: {
          shiftId: input.shiftId,
          workerId: input.workerId,
          clientId: input.clientId,
          failedDateIso: m.dateIso,
          failedMinuteOfDay: m.minuteOfDay,
          failedTimeFormatted: minuteOfDayToHHMM(m.minuteOfDay),
          underlyingPolicyCode: ev.code,
          details: ev.diagnostics,
        },
      };
    }
    const effectiveComponents = getEffectiveSurchargeComponents(
      ev.applicableComponents,
      ev.isNight,
      input.policy
    );
    evaluatedWorkMinutes.push({
      m,
      isSaturday: ev.isSaturday,
      isSunday: ev.isSunday,
      isHoliday: ev.isHoliday,
      holidayName: ev.holidayRecord?.name,
      isNight: ev.isNight,
      applicableComponents: effectiveComponents,
      effectiveSurchargeFraction: ev.effectiveSurchargeFraction,
      rateMultiplier: ev.rateMultiplier,
      breakdownDescriptionDE: ev.breakdownDescriptionDE,
    });
  }

  // 8. Group contiguous working minutes into Intervals
  const intervals: ShiftMinuteInterval[] = [];
  let intervalIdx = 1;
  let curIntervalStart: EvaluatedMinute = evaluatedWorkMinutes[0];
  let curIntervalCount = 1;

  for (let i = 1; i < evaluatedWorkMinutes.length; i++) {
    const prev = evaluatedWorkMinutes[i - 1];
    const curr = evaluatedWorkMinutes[i];

    // Check if contiguous and matching all surcharge properties
    const isContiguous =
      curr.m.minuteIndex === prev.m.minuteIndex + 1 &&
      curr.m.dateIso === prev.m.dateIso &&
      curr.m.minuteOfDay === prev.m.minuteOfDay + 1;

    const matchesProperties =
      curr.isNight === prev.isNight &&
      curr.isSaturday === prev.isSaturday &&
      curr.isSunday === prev.isSunday &&
      curr.isHoliday === prev.isHoliday &&
      curr.holidayName === prev.holidayName &&
      curr.effectiveSurchargeFraction === prev.effectiveSurchargeFraction &&
      curr.rateMultiplier === prev.rateMultiplier;

    if (isContiguous && matchesProperties) {
      curIntervalCount++;
    } else {
      const startUtc = new Date(curIntervalStart.m.utcMs).toISOString();
      const endUtc = new Date(prev.m.utcMs + 60000).toISOString();
      intervals.push({
        intervalIndex: intervalIdx++,
        dateIso: curIntervalStart.m.dateIso,
        startMinuteOfDay: curIntervalStart.m.minuteOfDay,
        endMinuteOfDay: prev.m.minuteOfDay + 1,
        startTime: minuteOfDayToHHMM(curIntervalStart.m.minuteOfDay),
        endTime: minuteOfDayToHHMM(prev.m.minuteOfDay + 1),
        startDateTime: startUtc,
        endDateTime: endUtc,
        durationMinutes: curIntervalCount,
        isNight: curIntervalStart.isNight,
        isSaturday: curIntervalStart.isSaturday,
        isSunday: curIntervalStart.isSunday,
        isHoliday: curIntervalStart.isHoliday,
        holidayName: curIntervalStart.holidayName,
        applicableComponents: curIntervalStart.applicableComponents,
        effectiveSurchargeFraction: curIntervalStart.effectiveSurchargeFraction,
        rateMultiplier: curIntervalStart.rateMultiplier,
        breakdownDescriptionDE: curIntervalStart.breakdownDescriptionDE,
      });

      curIntervalStart = curr;
      curIntervalCount = 1;
    }
  }

  // Push final interval
  const lastEv = evaluatedWorkMinutes[evaluatedWorkMinutes.length - 1];
  const finalStartUtc = new Date(curIntervalStart.m.utcMs).toISOString();
  const finalEndUtc = new Date(lastEv.m.utcMs + 60000).toISOString();
  intervals.push({
    intervalIndex: intervalIdx++,
    dateIso: curIntervalStart.m.dateIso,
    startMinuteOfDay: curIntervalStart.m.minuteOfDay,
    endMinuteOfDay: lastEv.m.minuteOfDay + 1,
    startTime: minuteOfDayToHHMM(curIntervalStart.m.minuteOfDay),
    endTime: minuteOfDayToHHMM(lastEv.m.minuteOfDay + 1),
    startDateTime: finalStartUtc,
    endDateTime: finalEndUtc,
    durationMinutes: curIntervalCount,
    isNight: curIntervalStart.isNight,
    isSaturday: curIntervalStart.isSaturday,
    isSunday: curIntervalStart.isSunday,
    isHoliday: curIntervalStart.isHoliday,
    holidayName: curIntervalStart.holidayName,
    applicableComponents: curIntervalStart.applicableComponents,
    effectiveSurchargeFraction: curIntervalStart.effectiveSurchargeFraction,
    rateMultiplier: curIntervalStart.rateMultiplier,
    breakdownDescriptionDE: curIntervalStart.breakdownDescriptionDE,
  });

  // 9. Aggregate Surcharge Minutes Summary (non-inflating)
  let saturdayMinutes = 0;
  let sundayMinutes = 0;
  let holidayMinutes = 0;
  let nightMinutes = 0;

  for (const ev of evaluatedWorkMinutes) {
    if (ev.applicableComponents.includes("sat")) saturdayMinutes++;
    if (ev.applicableComponents.includes("sun")) sundayMinutes++;
    if (ev.applicableComponents.includes("holiday")) holidayMinutes++;
    if (ev.applicableComponents.includes("night")) nightMinutes++;
  }

  // 10. Prepare Structured Line Items for Phase 5 exact billing
  const preparedLineItems: PreparedWorkLineItem[] = [];

  // Base Line Item (bills 100% of base rate, incremental surcharge fraction = 0)
  preparedLineItems.push({
    workerId: input.workerId,
    workerName: input.workerName,
    qualification: input.qualification,
    itemCategory: "base",
    surchargePolicyId: input.policy.policyId,
    surchargePolicyVersion: input.policy.policyVersion,
    minutes: netWorkMinutes,
    rateMultiplier: 1.0,
    rateFraction: 0,
    surchargeFraction: 0,
    combinationRule: input.policy.combinationRule,
    descriptionDE: `Grundvergütung (${(netWorkMinutes / 60).toFixed(2)} Std.)`,
  });

  // Saturday Surcharge Item (bills incremental surcharge percentage only, avoiding base double-counting)
  if (saturdayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_saturday",
      surchargePolicyId: input.policy.policyId,
      surchargePolicyVersion: input.policy.policyVersion,
      minutes: saturdayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.sat,
      rateFraction: input.policy.surcharges.sat,
      surchargeFraction: input.policy.surcharges.sat,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Samstagszuschlag (+${(input.policy.surcharges.sat * 100).toFixed(0)}%)`,
    });
  }

  // Sunday Surcharge Item (bills incremental surcharge percentage only, avoiding base double-counting)
  if (sundayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_sunday",
      surchargePolicyId: input.policy.policyId,
      surchargePolicyVersion: input.policy.policyVersion,
      minutes: sundayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.sun,
      rateFraction: input.policy.surcharges.sun,
      surchargeFraction: input.policy.surcharges.sun,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Sonntagszuschlag (+${(input.policy.surcharges.sun * 100).toFixed(0)}%)`,
    });
  }

  // Holiday Surcharge Item (bills incremental surcharge percentage only, avoiding base double-counting)
  if (holidayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_holiday",
      surchargePolicyId: input.policy.policyId,
      surchargePolicyVersion: input.policy.policyVersion,
      minutes: holidayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.holiday,
      rateFraction: input.policy.surcharges.holiday,
      surchargeFraction: input.policy.surcharges.holiday,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Feiertagszuschlag (+${(input.policy.surcharges.holiday * 100).toFixed(0)}%)`,
    });
  }

  // Night Surcharge Item (bills incremental surcharge percentage only, avoiding base double-counting)
  if (nightMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_night",
      surchargePolicyId: input.policy.policyId,
      surchargePolicyVersion: input.policy.policyVersion,
      minutes: nightMinutes,
      rateMultiplier: 1 + input.policy.surcharges.night,
      rateFraction: input.policy.surcharges.night,
      surchargeFraction: input.policy.surcharges.night,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Nachtzuschlag (+${(input.policy.surcharges.night * 100).toFixed(0)}%)`,
    });
  }

  const result: ShiftMinuteSplitSuccess = {
    status: "resolved",
    shiftId: input.shiftId,
    assignmentId: input.assignmentId,
    orderId: input.orderId,
    workerId: input.workerId,
    workerName: input.workerName,
    clientId: input.clientId,
    facilityName: input.facilityName,
    qualification: input.qualification,

    effectiveHoursVersion: input.effectiveWorkHoursRef.effectiveVersion,
    effectiveHoursSource: input.effectiveWorkHoursRef.source,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    policyFrozenHash: input.policy.frozenHash,
    combinationRule: input.policy.combinationRule,

    grossShiftMinutes,
    breakMinutes: totalBreakMinutes,
    netWorkMinutes,

    surchargeMinutes: {
      saturdayMinutes,
      sundayMinutes,
      holidayMinutes,
      nightMinutes,
    },

    intervals,
    breakIntervals,
    preparedLineItems,
  };

  // Self-verification of mathematical invariants
  const invariantCheck = validateMinuteSplittingInvariants(result);
  if (!invariantCheck.valid) {
    throw new Error(
      `Mathematical invariant check failed in splitShiftMinutes: ${invariantCheck.errors.join("; ")}`
    );
  }

  return result;
}

/**
 * Pure Read-Only Adapter: Resolves effective work hours from Phase 3c and executes minute splitting.
 * Guarantees zero mutations on any database tables.
 */
export async function splitAssignmentMinutesFromEffective(params: {
  assignmentId: string;
  policy: ResolvedSurchargePolicySuccess;
  qualification?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOrTx?: any;
  breakAllocationRule?: "proportional" | null;
  breakAllocationSourceReference?: string;
}): Promise<ShiftMinuteSplitResult> {
  const { assignmentId, policy, qualification = "pflegefachkraft", clientOrTx } = params;

  // 1. Fetch effective hours from Phase 3c
  const { getAssignmentEffectiveWorkHours } = await import(
    "./confirmation-evidence-service"
  );
  const effective = await getAssignmentEffectiveWorkHours(assignmentId, clientOrTx);

  // 2. Fetch assignment metadata (worker, client, shift date)
  const tx = clientOrTx || (await import("@/lib/prisma")).prisma;
  const assignment = await tx.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: {
        select: { id: true, fullName: true },
      },
      order: {
        select: {
          id: true,
          shiftDate: true,
          clientId: true,
          client: { select: { facilityName: true } },
          startTime: true,
          endTime: true,
          breakMinutes: true,
        },
      },
    },
  });

  if (!assignment) {
    return {
      status: "unresolved",
      code: "INVALID_TIME_INTERVAL",
      message: `Assignment mit ID "${assignmentId}" wurde nicht gefunden.`,
      diagnostics: { assignmentId },
    };
  }

  const input: ShiftMinuteSplitterInput = {
    shiftId: assignment.id,
    assignmentId: assignment.id,
    orderId: assignment.order.id,
    workerId: assignment.worker.id,
    workerName: assignment.worker.fullName,
    clientId: assignment.order.clientId,
    facilityName: assignment.order.client?.facilityName,
    qualification,
    shiftDate: assignment.order.shiftDate,
    startTime: effective.effectiveStartTime,
    endTime: effective.effectiveEndTime,
    breakMinutes: effective.effectiveBreakMinutes,
    contractualBreakAllocationRule: params.breakAllocationRule,
    breakAllocationSourceReference: params.breakAllocationSourceReference,
    effectiveWorkHoursRef: {
      effectiveHours: effective.effectiveHours,
      effectiveVersion: effective.effectiveVersion,
      source: effective.source,
      isCorrected: effective.isCorrected,
      approvedCorrectionId: effective.approvedCorrection?.id,
      approvedCorrectionRevision: effective.approvedCorrection?.revision,
    },
    policy,
  };

  return splitShiftMinutes(input);
}

/**
 * Pure Transformation Adapter:
 * Converts Phase 4b PreparedWorkLineItems into Phase 2 RawWorkLineInputs for exact billing.
 *
 * Strict Financial Contract:
 * - Base work hours are billed 100% exactly ONCE for net work minutes.
 * - Surcharge line items bill ONLY the incremental surcharge portion (surchargeFraction),
 *   never double-billing the base hourly rate.
 * - priceVersionId must be supplied by the caller from the actual Price/Contract record (Phase 5).
 */
export function convertPreparedItemsToRawInvoiceLines(params: {
  preparedItems: PreparedWorkLineItem[];
  priceVersionId: string;
  baseHourlyRateInCents: number;
}): RawWorkLineInput[] {
  if (!params.priceVersionId || !params.priceVersionId.trim()) {
    throw new Error(
      "priceVersionId ist zwingend erforderlich für die Rechnungszeilen-Generierung."
    );
  }
  if (
    !Number.isSafeInteger(params.baseHourlyRateInCents) ||
    params.baseHourlyRateInCents < 0
  ) {
    throw new Error("baseHourlyRateInCents muss eine nicht-negative ganze Zahl sein.");
  }

  return params.preparedItems.map((item) => {
    if (item.itemCategory === "base") {
      return {
        workerId: item.workerId,
        workerName: item.workerName,
        qualification: item.qualification,
        itemCategory: "base",
        priceVersionId: params.priceVersionId,
        minutes: item.minutes,
        hourlyRate: { cents: params.baseHourlyRateInCents },
        description: item.descriptionDE,
      };
    } else {
      return {
        workerId: item.workerId,
        workerName: item.workerName,
        qualification: item.qualification,
        itemCategory: item.itemCategory,
        priceVersionId: params.priceVersionId,
        minutes: item.minutes,
        baseHourlyRate: { cents: params.baseHourlyRateInCents },
        surchargeRatio: item.surchargeFraction,
        deriveSurchargeRate: true,
        description: item.descriptionDE,
      };
    }
  });
}
