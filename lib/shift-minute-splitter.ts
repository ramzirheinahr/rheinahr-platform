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
  type ResolvedSurchargePolicySuccess,
  type SurchargeCombinationRule,
  type SurchargeComponent,
} from "./surcharge-policy";
import {
  DEFAULT_TIMEZONE,
  isValidTimeString,
  resolveWallTimeToUtc,
} from "./shift-overlap-engine";

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

export type ShiftMinuteInterval = {
  intervalIndex: number;
  dateIso: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number; // exclusive (0..1440)
  startTime: string;      // "HH:mm"
  endTime: string;        // "HH:mm"
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
  priceVersionId: string;
  minutes: number;
  rateMultiplier: number; // 1.0 for base, rateMultiplier for combined
  rateFraction: number;   // 0 for base, effective surcharge fraction for surcharge line
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

  // 3. Sum of break interval durations = breakMinutes
  const sumBreakIntervals = result.breakIntervals.reduce(
    (acc, it) => acc + it.durationMinutes,
    0
  );
  if (sumBreakIntervals !== result.breakMinutes) {
    errors.push(
      `Invariant failed: sum of breakIntervals (${sumBreakIntervals}) != breakMinutes (${result.breakMinutes})`
    );
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

  if (input.startDateTime && input.endDateTime) {
    // Explicit Date / ISO string input
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
  let currDateIso = startDayIso;
  let currMinuteOfDay = startH * 60 + startMin;
  const targetEndMinuteOfDay = endH * 60 + endMin;
  const targetEndDateIso = explicitEndDayIso || startDayIso;

  let minuteIdx = 0;
  while (true) {
    if (currDateIso === targetEndDateIso && currMinuteOfDay === targetEndMinuteOfDay) {
      break;
    }
    minutes.push({
      minuteIndex: minuteIdx++,
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
      let bStartIso: string;
      let bStartMod: number;
      let bEndIso: string;
      let bEndMod: number;

      if (typeof bw.start === "string" && isValidTimeString(bw.start) && typeof bw.end === "string" && isValidTimeString(bw.end)) {
        bStartIso = bw.dateIso || startDayIso;
        bEndIso = bw.dateIso || startDayIso;
        const [bh1, bm1] = bw.start.split(":").map(Number);
        const [bh2, bm2] = bw.end.split(":").map(Number);
        bStartMod = bh1 * 60 + bm1;
        bEndMod = bh2 * 60 + bm2;
        if (bEndMod < bStartMod) {
          bEndIso = advanceCalendarDay(bStartIso);
        }
      } else {
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
        const sFmt = formatInTimeZone(sD, tz, "yyyy-MM-dd HH:mm");
        const eFmt = formatInTimeZone(eD, tz, "yyyy-MM-dd HH:mm");
        bStartIso = sFmt.slice(0, 10);
        bStartMod = Number(sFmt.slice(11, 13)) * 60 + Number(sFmt.slice(14, 16));
        bEndIso = eFmt.slice(0, 10);
        bEndMod = Number(eFmt.slice(11, 13)) * 60 + Number(eFmt.slice(14, 16));
      }

      // Check if break window matches any shift minutes
      let matchedCount = 0;
      let curBDate = bStartIso;
      let curBMod = bStartMod;

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

    if (distinctProfiles.size > 1) {
      // Crosses surcharge boundaries!
      if (input.contractualBreakAllocationRule === "proportional") {
        // Contractually documented proportional allocation
        // Count minutes per category profile
        const profileMinutes = new Map<string, number>();
        for (const ev of evaluatedAll) {
          if (ev.status !== "resolved") continue;
          const key = `${ev.applicableComponents.slice().sort().join("+")}|${ev.rateMultiplier}`;
          profileMinutes.set(key, (profileMinutes.get(key) || 0) + 1);
        }

        // Distribute break proportionally
        // We will mark break minutes proportionally from the end of each category cluster
        const breakDeductionPerProfile = new Map<string, number>();
        let allocatedSum = 0;

        for (const [key, count] of profileMinutes.entries()) {
          const alloc = Math.round((count / grossShiftMinutes) * totalBreakMinutes);
          breakDeductionPerProfile.set(key, alloc);
          allocatedSum += alloc;
        }

        // Adjust rounding delta to guarantee exact sum
        const delta = totalBreakMinutes - allocatedSum;
        if (delta !== 0) {
          const firstKey = profileMinutes.keys().next().value;
          if (firstKey) {
            breakDeductionPerProfile.set(
              firstKey,
              (breakDeductionPerProfile.get(firstKey) || 0) + delta
            );
          }
        }

        // Apply deduction to minutes
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

  // Build Break Intervals
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
        breakIntervals.push({
          intervalIndex: breakIntIdx++,
          dateIso: curBreakStart.dateIso,
          startMinuteOfDay: curBreakStart.minuteOfDay,
          endMinuteOfDay: lastM.minuteOfDay + 1,
          startTime: minuteOfDayToHHMM(curBreakStart.minuteOfDay),
          endTime: minuteOfDayToHHMM(lastM.minuteOfDay + 1),
          durationMinutes: i - curBreakStart.minuteIndex,
        });
        curBreakStart = null;
      }
    }
  }
  if (curBreakStart) {
    const lastM = minutes[minutes.length - 1];
    breakIntervals.push({
      intervalIndex: breakIntIdx++,
      dateIso: curBreakStart.dateIso,
      startMinuteOfDay: curBreakStart.minuteOfDay,
      endMinuteOfDay: lastM.minuteOfDay + 1,
      startTime: minuteOfDayToHHMM(curBreakStart.minuteOfDay),
      endTime: minuteOfDayToHHMM(lastM.minuteOfDay + 1),
      durationMinutes: minutes.length - curBreakStart.minuteIndex,
    });
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
      curr.m.dateIso === prev.m.dateIso;

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
      intervals.push({
        intervalIndex: intervalIdx++,
        dateIso: curIntervalStart.m.dateIso,
        startMinuteOfDay: curIntervalStart.m.minuteOfDay,
        endMinuteOfDay: prev.m.minuteOfDay + 1,
        startTime: minuteOfDayToHHMM(curIntervalStart.m.minuteOfDay),
        endTime: minuteOfDayToHHMM(prev.m.minuteOfDay + 1),
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
  intervals.push({
    intervalIndex: intervalIdx++,
    dateIso: curIntervalStart.m.dateIso,
    startMinuteOfDay: curIntervalStart.m.minuteOfDay,
    endMinuteOfDay: lastEv.m.minuteOfDay + 1,
    startTime: minuteOfDayToHHMM(curIntervalStart.m.minuteOfDay),
    endTime: minuteOfDayToHHMM(lastEv.m.minuteOfDay + 1),
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

  // Base Line Item
  preparedLineItems.push({
    workerId: input.workerId,
    workerName: input.workerName,
    qualification: input.qualification,
    itemCategory: "base",
    priceVersionId: input.policy.policyId,
    minutes: netWorkMinutes,
    rateMultiplier: 1.0,
    rateFraction: 0,
    combinationRule: input.policy.combinationRule,
    descriptionDE: `Grundvergütung (${(netWorkMinutes / 60).toFixed(2)} Std.)`,
  });

  // Saturday Surcharge Item
  if (saturdayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_saturday",
      priceVersionId: input.policy.policyId,
      minutes: saturdayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.sat,
      rateFraction: input.policy.surcharges.sat,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Samstagszuschlag (+${(input.policy.surcharges.sat * 100).toFixed(0)}%)`,
    });
  }

  // Sunday Surcharge Item
  if (sundayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_sunday",
      priceVersionId: input.policy.policyId,
      minutes: sundayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.sun,
      rateFraction: input.policy.surcharges.sun,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Sonntagszuschlag (+${(input.policy.surcharges.sun * 100).toFixed(0)}%)`,
    });
  }

  // Holiday Surcharge Item
  if (holidayMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_holiday",
      priceVersionId: input.policy.policyId,
      minutes: holidayMinutes,
      rateMultiplier: 1 + input.policy.surcharges.holiday,
      rateFraction: input.policy.surcharges.holiday,
      combinationRule: input.policy.combinationRule,
      descriptionDE: `Feiertagszuschlag (+${(input.policy.surcharges.holiday * 100).toFixed(0)}%)`,
    });
  }

  // Night Surcharge Item
  if (nightMinutes > 0) {
    preparedLineItems.push({
      workerId: input.workerId,
      workerName: input.workerName,
      qualification: input.qualification,
      itemCategory: "surcharge_night",
      priceVersionId: input.policy.policyId,
      minutes: nightMinutes,
      rateMultiplier: 1 + input.policy.surcharges.night,
      rateFraction: input.policy.surcharges.night,
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
