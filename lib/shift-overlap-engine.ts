import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIMEZONE = "Europe/Berlin";

export type ShiftInput = {
  orderId: string;
  requestGroupId?: string | null;
  shiftDate: Date; // UTC midnight or Date representing the calendar date
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  status: string; // OrderStatus e.g. "pending", "confirmed", "cancelled", etc.
  facilityName: string;
  clientId: string;
  workerId: string;
  workerName: string;
  workerInternalNumber?: string | null;
  assignmentId: string;
  assignmentStatus: string; // AssignmentStatus e.g. "pending", "confirmed", "declined"
  timezone?: string | null;
};

export type ShiftInterval = {
  shift: ShiftInput;
  startUtcMs: number;
  endUtcMs: number;
  startFormatted: string; // "YYYY-MM-DD HH:mm"
  endFormatted: string; // "YYYY-MM-DD HH:mm"
  isCrossMidnight: boolean;
  dstWarning?: string | null;
  isTimeAmbiguousOrInvalid?: boolean;
};

export type UncertainShiftWarning = {
  id: string; // orderId or `${orderId}_${reason}`
  orderId: string;
  requestGroupId?: string | null;
  workerId: string;
  workerName: string;
  workerInternalNumber?: string | null;
  facilityName: string;
  shiftDate: string; // "DD.MM.YYYY"
  startTime: string;
  endTime: string;
  reason: "INVALID_TIME_FORMAT" | "DST_GAP" | "DST_AMBIGUOUS";
  message: string;
};

export type ShiftOverlapPair = {
  id: string; // unique deterministic id: `${shiftA.orderId}_${shiftB.orderId}`
  workerId: string;
  workerName: string;
  workerInternalNumber?: string | null;
  dateKey: string; // e.g. "YYYY-MM-DD"
  overlapMinutes: number; // Definite overlap minutes within the selected month
  overlapStartUtcMs: number;
  overlapEndUtcMs: number;
  shiftA: {
    orderId: string;
    requestGroupId?: string | null;
    assignmentId: string;
    shiftDate: string; // formatted date "DD.MM.YYYY"
    startTime: string; // "HH:mm"
    endTime: string; // "HH:mm"
    facilityName: string;
    clientId: string;
    status: string;
    isCrossMidnight: boolean;
  };
  shiftB: {
    orderId: string;
    requestGroupId?: string | null;
    assignmentId: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    facilityName: string;
    clientId: string;
    status: string;
    isCrossMidnight: boolean;
  };
};

export type WorkerOverlapGroup = {
  workerId: string;
  workerName: string;
  workerInternalNumber?: string | null;
  pairs: ShiftOverlapPair[];
  totalOverlapMinutes: number;
};

export type ShiftOverlapReportResult = {
  year: number;
  month: number;
  affectedWorkersCount: number;
  totalOverlapPairsCount: number;
  workerGroups: WorkerOverlapGroup[];
  hasDstWarnings: boolean;
  uncertainWarnings: UncertainShiftWarning[];
};

/**
 * Validates year and month parameters.
 * Throws an error for invalid ranges (year < 2000 or > 2100, month < 1 or > 12).
 */
export function validateYearMonth(year: unknown, month: unknown): { year: number; month: number } {
  const y = Number(year);
  const m = Number(month);

  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    throw new Error(`Ungültiges Jahr: ${year}. Das Jahr muss zwischen 2000 und 2100 liegen.`);
  }

  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Ungültiger Monat: ${month}. Der Monat muss zwischen 1 und 12 liegen.`);
  }

  return { year: y, month: m };
}

/**
 * Validates whether a time string strictly matches "HH:mm" with hours 00-23 and minutes 00-59.
 */
export function isValidTimeString(timeStr: unknown): timeStr is string {
  if (typeof timeStr !== "string") return false;
  const match = timeStr.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Resolves a local wall clock time (year, month, day, hour, minute) in a given timezone
 * into exact UTC milliseconds.
 * Detects DST transitions:
 * - Spring-forward gap (time doesn't exist): flags invalid/gap warning.
 * - Fall-back overlap (time exists twice): flags ambiguous/overlap warning.
 */
export function resolveWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = DEFAULT_TIMEZONE
): {
  utcMs: number;
  warning: string | null;
  warningType: "DST_GAP" | "DST_AMBIGUOUS" | null;
  isAmbiguousOrInvalid: boolean;
} {
  const pad = (n: number) => String(n).padStart(2, "0");
  const targetStr = `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute);

  // Scan offset window (-60 min to +240 min)
  const matches: number[] = [];
  for (let offsetMin = -60; offsetMin <= 240; offsetMin++) {
    const candidateMs = baseUtcMs - offsetMin * 60 * 1000;
    const formatted = formatInTimeZone(candidateMs, timeZone, "yyyy-MM-dd HH:mm");
    if (formatted === targetStr) {
      if (!matches.includes(candidateMs)) {
        matches.push(candidateMs);
      }
    }
  }

  if (matches.length === 0) {
    // Gap: local time does not exist in target time zone
    const fallbackDate = fromZonedTime(
      `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`,
      timeZone
    );
    return {
      utcMs: fallbackDate.getTime(),
      warning: `DST_GAP: ${targetStr} does not exist in timezone ${timeZone}`,
      warningType: "DST_GAP",
      isAmbiguousOrInvalid: true,
    };
  }

  if (matches.length > 1) {
    // Overlap: local time is ambiguous
    return {
      utcMs: matches[0],
      warning: `DST_AMBIGUOUS: ${targetStr} occurs multiple times in timezone ${timeZone}`,
      warningType: "DST_AMBIGUOUS",
      isAmbiguousOrInvalid: true,
    };
  }

  return {
    utcMs: matches[0],
    warning: null,
    warningType: null,
    isAmbiguousOrInvalid: false,
  };
}

/**
 * Parses a ShiftInput into an absolute time interval [startUtcMs, endUtcMs].
 * Handles overnight shifts (where endTime <= startTime), advancing end date by +1 day.
 * Returns null if the shift time format is invalid.
 */
export function parseShiftInterval(
  shift: ShiftInput,
  timeZone: string = DEFAULT_TIMEZONE
): ShiftInterval | null {
  if (!isValidTimeString(shift.startTime) || !isValidTimeString(shift.endTime)) {
    return null;
  }

  const tz = shift.timezone || timeZone;
  const d = new Date(shift.shiftDate);
  if (isNaN(d.getTime())) {
    return null;
  }

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-indexed
  const day = d.getUTCDate();

  const [startH, startMin] = shift.startTime.split(":").map((v) => parseInt(v, 10));
  const [endH, endMin] = shift.endTime.split(":").map((v) => parseInt(v, 10));

  const startMinutes = startH * 60 + startMin;
  const endMinutes = endH * 60 + endMin;

  const isCrossMidnight = endMinutes <= startMinutes;

  const startRes = resolveWallTimeToUtc(y, m, day, startH, startMin, tz);

  let endY = y;
  let endM = m;
  let endDay = day;

  if (isCrossMidnight) {
    const nextUtcDay = new Date(Date.UTC(y, m - 1, day + 1));
    endY = nextUtcDay.getUTCFullYear();
    endM = nextUtcDay.getUTCMonth() + 1;
    endDay = nextUtcDay.getUTCDate();
  }

  const endRes = resolveWallTimeToUtc(endY, endM, endDay, endH, endMin, tz);

  const pad = (n: number) => String(n).padStart(2, "0");
  const startFormatted = `${y}-${pad(m)}-${pad(day)} ${pad(startH)}:${pad(startMin)}`;
  const endFormatted = `${endY}-${pad(endM)}-${pad(endDay)} ${pad(endH)}:${pad(endMin)}`;

  let dstWarning: string | null = null;
  if (startRes.warning && endRes.warning) {
    dstWarning = `${startRes.warning}; ${endRes.warning}`;
  } else if (startRes.warning) {
    dstWarning = startRes.warning;
  } else if (endRes.warning) {
    dstWarning = endRes.warning;
  }

  const isTimeAmbiguousOrInvalid = startRes.isAmbiguousOrInvalid || endRes.isAmbiguousOrInvalid;

  return {
    shift,
    startUtcMs: startRes.utcMs,
    endUtcMs: endRes.utcMs,
    startFormatted,
    endFormatted,
    isCrossMidnight,
    dstWarning,
    isTimeAmbiguousOrInvalid,
  };
}

/**
 * Calculates overlaps for a list of shifts within a target month [year, month].
 *
 * Rules:
 * - Validates year and month strictly.
 * - Excludes cancelled orders (`status === 'cancelled'`)
 * - Excludes declined assignments (`assignmentStatus === 'declined'`)
 * - Shifts with corrupted time format (e.g. "xx:30", "25:00", "12:99") are separated into `uncertainWarnings`.
 * - Shifts with DST_GAP or DST_AMBIGUOUS times are separated into `uncertainWarnings` and excluded from definite counts/minutes.
 * - Shifts are compared per worker (grouped by `workerId`).
 * - Uses exact condition: `max(startA, startB) < min(endA, endB)`.
 * - Zero overlap if `max(startA, startB) >= min(endA, endB)` (e.g. 14:00 and 14:00).
 * - Exact month portion: `max(overlapStart, monthStart)` to `min(overlapEnd, monthEnd)`.
 *   Minutes occurring in the previous or next month are NOT attributed to this month.
 * - Does not duplicate pairs (A-B and B-A are identical; reported once with canonical order).
 */
export function detectShiftOverlaps(
  shifts: ShiftInput[],
  year: number,
  month: number,
  timeZone: string = DEFAULT_TIMEZONE
): ShiftOverlapReportResult {
  const { year: validYear, month: validMonth } = validateYearMonth(year, month);

  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStartUtcMs = fromZonedTime(
    `${validYear}-${pad(validMonth)}-01T00:00:00`,
    timeZone
  ).getTime();

  let nextYear = validYear;
  let nextMonth = validMonth + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const monthEndUtcMs = fromZonedTime(
    `${nextYear}-${pad(nextMonth)}-01T00:00:00`,
    timeZone
  ).getTime();

  const formatDateLabel = (d: Date) => {
    const dt = new Date(d);
    return `${pad(dt.getUTCDate())}.${pad(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()}`;
  };

  // 1. Filter out cancelled orders and declined assignments
  const activeShifts = shifts.filter(
    (s) => s.status !== "cancelled" && s.assignmentStatus !== "declined"
  );

  const uncertainWarnings: UncertainShiftWarning[] = [];
  const validIntervals: ShiftInterval[] = [];

  // 2. Parse intervals and separate corrupted / ambiguous shifts
  for (const s of activeShifts) {
    if (!isValidTimeString(s.startTime) || !isValidTimeString(s.endTime)) {
      uncertainWarnings.push({
        id: `inv-${s.orderId}`,
        orderId: s.orderId,
        requestGroupId: s.requestGroupId,
        workerId: s.workerId,
        workerName: s.workerName,
        workerInternalNumber: s.workerInternalNumber,
        facilityName: s.facilityName,
        shiftDate: formatDateLabel(s.shiftDate),
        startTime: s.startTime,
        endTime: s.endTime,
        reason: "INVALID_TIME_FORMAT",
        message: `Ungültiges Zeitformat: ${s.startTime}–${s.endTime}. Erwartet wird HH:mm (00:00–23:59).`,
      });
      continue;
    }

    const interval = parseShiftInterval(s, timeZone);
    if (!interval) {
      uncertainWarnings.push({
        id: `inv-${s.orderId}`,
        orderId: s.orderId,
        requestGroupId: s.requestGroupId,
        workerId: s.workerId,
        workerName: s.workerName,
        workerInternalNumber: s.workerInternalNumber,
        facilityName: s.facilityName,
        shiftDate: formatDateLabel(s.shiftDate),
        startTime: s.startTime,
        endTime: s.endTime,
        reason: "INVALID_TIME_FORMAT",
        message: `Ungültige Schichtdaten.`,
      });
      continue;
    }

    if (interval.isTimeAmbiguousOrInvalid) {
      const isGap = interval.dstWarning?.includes("DST_GAP");
      uncertainWarnings.push({
        id: `dst-${s.orderId}`,
        orderId: s.orderId,
        requestGroupId: s.requestGroupId,
        workerId: s.workerId,
        workerName: s.workerName,
        workerInternalNumber: s.workerInternalNumber,
        facilityName: s.facilityName,
        shiftDate: formatDateLabel(s.shiftDate),
        startTime: s.startTime,
        endTime: s.endTime,
        reason: isGap ? "DST_GAP" : "DST_AMBIGUOUS",
        message: interval.dstWarning || "Zeitumstellung / unklare Zeitangabe",
      });
      // Excluded from definite overlap computation
      continue;
    }

    validIntervals.push(interval);
  }

  // 3. Group valid intervals by workerId
  const workerMap = new Map<string, ShiftInterval[]>();
  for (const interval of validIntervals) {
    const wId = interval.shift.workerId;
    const list = workerMap.get(wId) || [];
    list.push(interval);
    workerMap.set(wId, list);
  }

  const workerGroups: WorkerOverlapGroup[] = [];
  let totalOverlapPairsCount = 0;

  for (const [wId, workerIntervals] of workerMap.entries()) {
    workerIntervals.sort((a, b) => a.startUtcMs - b.startUtcMs);

    const pairs: ShiftOverlapPair[] = [];
    const n = workerIntervals.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = workerIntervals[i];
        const b = workerIntervals[j];

        if (a.shift.orderId === b.shift.orderId) continue;

        const overlapStart = Math.max(a.startUtcMs, b.startUtcMs);
        const overlapEnd = Math.min(a.endUtcMs, b.endUtcMs);

        if (overlapStart < overlapEnd) {
          // Calculate intersection with the target month:
          // [effectiveStart, effectiveEnd) = [overlapStart, overlapEnd) ∩ [monthStartUtcMs, monthEndUtcMs)
          const effectiveStart = Math.max(overlapStart, monthStartUtcMs);
          const effectiveEnd = Math.min(overlapEnd, monthEndUtcMs);

          if (effectiveStart < effectiveEnd) {
            const overlapMinutes = Math.round((effectiveEnd - effectiveStart) / (60 * 1000));
            if (overlapMinutes <= 0) continue;

            const dateKey = formatInTimeZone(effectiveStart, timeZone, "yyyy-MM-dd");

            const isAFirst = a.shift.orderId < b.shift.orderId;
            const shiftFirst = isAFirst ? a : b;
            const shiftSecond = isAFirst ? b : a;

            const pairId = `${shiftFirst.shift.orderId}_${shiftSecond.shift.orderId}`;

            pairs.push({
              id: pairId,
              workerId: wId,
              workerName: a.shift.workerName,
              workerInternalNumber: a.shift.workerInternalNumber,
              dateKey,
              overlapMinutes,
              overlapStartUtcMs: effectiveStart,
              overlapEndUtcMs: effectiveEnd,
              shiftA: {
                orderId: a.shift.orderId,
                requestGroupId: a.shift.requestGroupId,
                assignmentId: a.shift.assignmentId,
                shiftDate: formatDateLabel(a.shift.shiftDate),
                startTime: a.shift.startTime,
                endTime: a.shift.endTime,
                facilityName: a.shift.facilityName,
                clientId: a.shift.clientId,
                status: a.shift.status,
                isCrossMidnight: a.isCrossMidnight,
              },
              shiftB: {
                orderId: b.shift.orderId,
                requestGroupId: b.shift.requestGroupId,
                assignmentId: b.shift.assignmentId,
                shiftDate: formatDateLabel(b.shift.shiftDate),
                startTime: b.shift.startTime,
                endTime: b.shift.endTime,
                facilityName: b.shift.facilityName,
                clientId: b.shift.clientId,
                status: b.shift.status,
                isCrossMidnight: b.isCrossMidnight,
              },
            });
          }
        }
      }
    }

    if (pairs.length > 0) {
      totalOverlapPairsCount += pairs.length;
      const totalOverlapMinutes = pairs.reduce((sum, p) => sum + p.overlapMinutes, 0);
      const firstWorkerShift = workerIntervals[0].shift;

      workerGroups.push({
        workerId: wId,
        workerName: firstWorkerShift.workerName,
        workerInternalNumber: firstWorkerShift.workerInternalNumber,
        pairs,
        totalOverlapMinutes,
      });
    }
  }

  workerGroups.sort((a, b) => a.workerName.localeCompare(b.workerName));

  return {
    year: validYear,
    month: validMonth,
    affectedWorkersCount: workerGroups.length,
    totalOverlapPairsCount,
    workerGroups,
    hasDstWarnings: uncertainWarnings.length > 0,
    uncertainWarnings,
  };
}
