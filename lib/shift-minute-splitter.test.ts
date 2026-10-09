/**
 * Phase 4b Acceptance & Adversarial Test Suite
 * RheinAhr Dienstleistungen GmbH - Shift Minute Splitting & Surcharges
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  splitShiftMinutes,
  splitAssignmentMinutesFromEffective,
  validateMinuteSplittingInvariants,
  convertPreparedItemsToRawInvoiceLines,
  type ShiftMinuteSplitterInput,
  type PreparedWorkLineItem,
} from "./shift-minute-splitter";
import { calculateExactInvoice } from "./invoice-exact-engine";
import {
  resolveInvoiceSurchargePolicy,
  type FacilitySurchargePolicyRecord,
  type ResolvedSurchargePolicySuccess,
} from "./surcharge-policy";
import { prisma } from "./prisma";

// Deterministic mock policy builder for tests
function createTestFrozenPolicy(
  overrides?: Partial<FacilitySurchargePolicyRecord>
): ResolvedSurchargePolicySuccess {
  const baseRecord: FacilitySurchargePolicyRecord = {
    clientId: "client-test-01",
    clientContractId: "contract-test-01",
    policyVersion: 1,
    federalState: "NW", // Nordrhein-Westfalen
    surchargeSat: 0.25, // +25%
    surchargeSun: 0.5,  // +50%
    surchargeHoliday: 1.0, // +100%
    surchargeNight: 0.25, // +25%
    nightStart: "22:00",
    nightEnd: "06:00",
    combinationRule: "highest_non_night_plus_night",
    sourceType: "contract",
    sourceReference: "Rahmenvertrag 2026 § 4",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    isFrozen: true,
    frozenHash: "", // will be calculated
    ...overrides,
  };

  const resolved = resolveInvoiceSurchargePolicy({
    policy: { ...baseRecord, isFrozen: false },
    referenceDate: "2026-05-01",
  });

  if (resolved.status !== "resolved") {
    throw new Error(`Failed to resolve test policy: ${resolved.message}`);
  }

  // Freeze it with the calculated hash
  const frozenRecord: FacilitySurchargePolicyRecord = {
    ...baseRecord,
    isFrozen: true,
    frozenHash: resolved.frozenHash,
  };

  const frozenRes = resolveInvoiceSurchargePolicy({
    policy: frozenRecord,
    referenceDate: "2026-05-01",
  });

  if (frozenRes.status !== "resolved") {
    throw new Error(`Failed to freeze test policy: ${frozenRes.message}`);
  }

  return frozenRes;
}

describe("Phase 4b Engine: Shift Minute Splitting, Breaks & Surcharge Calculation", () => {
  const defaultPolicy = createTestFrozenPolicy();

  describe("1. Regular Weekday Shift (Base only)", () => {
    it("partitions an 8-hour weekday daytime shift into base minutes with 0 surcharges", () => {
      // 2026-06-10 is Wednesday, non-holiday
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-reg-01",
        workerId: "worker-01",
        workerName: "Anna Schmidt",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-01:abc123",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(480);
        expect(result.netWorkMinutes).toBe(480);
        expect(result.breakMinutes).toBe(0);
        expect(result.surchargeMinutes.saturdayMinutes).toBe(0);
        expect(result.surchargeMinutes.sundayMinutes).toBe(0);
        expect(result.surchargeMinutes.holidayMinutes).toBe(0);
        expect(result.surchargeMinutes.nightMinutes).toBe(0);

        // Exactly one interval covering 08:00 to 16:00
        expect(result.intervals).toHaveLength(1);
        expect(result.intervals[0].startTime).toBe("08:00");
        expect(result.intervals[0].endTime).toBe("16:00");
        expect(result.intervals[0].durationMinutes).toBe(480);
        expect(result.intervals[0].rateMultiplier).toBe(1.0);
        expect(result.intervals[0].applicableComponents).toEqual([]);

        // Prepared line items: base only
        expect(result.preparedLineItems).toHaveLength(1);
        expect(result.preparedLineItems[0].itemCategory).toBe("base");
        expect(result.preparedLineItems[0].minutes).toBe(480);
        expect(result.preparedLineItems[0].rateMultiplier).toBe(1.0);

        // Invariants check
        const inv = validateMinuteSplittingInvariants(result);
        expect(inv.valid).toBe(true);
      }
    });
  });

  describe("2. Saturday & Sunday Shifts", () => {
    it("applies Saturday surcharge (+25%) without double-counting base hours", () => {
      // 2026-06-13 is Saturday
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-sat-01",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-13",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-02:def456",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.netWorkMinutes).toBe(480);
        expect(result.surchargeMinutes.saturdayMinutes).toBe(480);
        expect(result.surchargeMinutes.sundayMinutes).toBe(0);

        // Intervals have isSaturday = true, rateMultiplier = 1.25
        expect(result.intervals[0].isSaturday).toBe(true);
        expect(result.intervals[0].rateMultiplier).toBe(1.25);

        // Prepared line items: 1 base item (480 min) + 1 Saturday surcharge item (480 min)
        expect(result.preparedLineItems).toHaveLength(2);
        expect(result.preparedLineItems[0].itemCategory).toBe("base");
        expect(result.preparedLineItems[0].minutes).toBe(480);
        expect(result.preparedLineItems[1].itemCategory).toBe("surcharge_saturday");
        expect(result.preparedLineItems[1].minutes).toBe(480);
        expect(result.preparedLineItems[1].rateFraction).toBe(0.25);
      }
    });

    it("applies Sunday surcharge (+50%) accurately", () => {
      // 2026-06-14 is Sunday
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-sun-01",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-14",
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-03:ghi789",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.netWorkMinutes).toBe(480);
        expect(result.surchargeMinutes.sundayMinutes).toBe(480);
        expect(result.intervals[0].isSunday).toBe(true);
        expect(result.intervals[0].rateMultiplier).toBe(1.5);

        expect(result.preparedLineItems).toHaveLength(2);
        expect(result.preparedLineItems[1].itemCategory).toBe("surcharge_sunday");
        expect(result.preparedLineItems[1].minutes).toBe(480);
        expect(result.preparedLineItems[1].rateFraction).toBe(0.5);
      }
    });
  });

  describe("3. Overnight Shift Crossing Midnight (Day & Night Windows)", () => {
    it("partitions overnight shift at night start (22:00) and at midnight (00:00)", () => {
      // Shift from Wednesday 20:00 to Thursday 04:00 (8 hours = 480 min)
      // Night window is 22:00 to 06:00
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-night-01",
        workerId: "worker-02",
        clientId: "client-test-01",
        qualification: "pflegehelfer",
        shiftDate: "2026-06-10",
        startTime: "20:00",
        endTime: "04:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-04:jkl012",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(480);
        expect(result.netWorkMinutes).toBe(480);
        expect(result.surchargeMinutes.nightMinutes).toBe(360); // 22:00 to 04:00 = 6h = 360 min

        // Must be partitioned into 3 distinct contiguous intervals:
        // 1. 2026-06-10 20:00–22:00 (120 min, day, multiplier 1.0)
        // 2. 2026-06-10 22:00–24:00 (120 min, night, multiplier 1.25)
        // 3. 2026-06-11 00:00–04:00 (240 min, night next day, multiplier 1.25)
        expect(result.intervals).toHaveLength(3);

        expect(result.intervals[0].dateIso).toBe("2026-06-10");
        expect(result.intervals[0].startTime).toBe("20:00");
        expect(result.intervals[0].endTime).toBe("22:00");
        expect(result.intervals[0].durationMinutes).toBe(120);
        expect(result.intervals[0].isNight).toBe(false);
        expect(result.intervals[0].rateMultiplier).toBe(1.0);

        expect(result.intervals[1].dateIso).toBe("2026-06-10");
        expect(result.intervals[1].startTime).toBe("22:00");
        expect(result.intervals[1].endTime).toBe("24:00");
        expect(result.intervals[1].durationMinutes).toBe(120);
        expect(result.intervals[1].isNight).toBe(true);
        expect(result.intervals[1].rateMultiplier).toBe(1.25);

        expect(result.intervals[2].dateIso).toBe("2026-06-11"); // Date rollover!
        expect(result.intervals[2].startTime).toBe("00:00");
        expect(result.intervals[2].endTime).toBe("04:00");
        expect(result.intervals[2].durationMinutes).toBe(240);
        expect(result.intervals[2].isNight).toBe(true);
        expect(result.intervals[2].rateMultiplier).toBe(1.25);

        // Sum of intervals = 120 + 120 + 240 = 480
        expect(result.intervals.reduce((a, b) => a + b.durationMinutes, 0)).toBe(480);

        // Prepared line items
        expect(result.preparedLineItems).toHaveLength(2);
        expect(result.preparedLineItems[0].itemCategory).toBe("base");
        expect(result.preparedLineItems[0].minutes).toBe(480);
        expect(result.preparedLineItems[1].itemCategory).toBe("surcharge_night");
        expect(result.preparedLineItems[1].minutes).toBe(360);
      }
    });
  });

  describe("4. Holiday Starting Exactly at Midnight 00:00", () => {
    it("partitions an overnight shift crossing from regular day into Tag der Arbeit (May 1st) at 00:00", () => {
      // 2026-04-30 is regular Thursday
      // 2026-05-01 is Tag der Arbeit (statutory nationwide holiday)
      // Shift: 2026-04-30 20:00 to 2026-05-01 04:00 (8h = 480 min)
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-mayday-01",
        workerId: "worker-03",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-04-30",
        startTime: "20:00",
        endTime: "04:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-05:mno345",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.netWorkMinutes).toBe(480);
        expect(result.surchargeMinutes.holidayMinutes).toBe(240); // 00:00 to 04:00
        expect(result.surchargeMinutes.nightMinutes).toBe(360);   // 22:00 to 04:00

        // Intervals:
        // 1. 2026-04-30 20:00–22:00 (120 min, regular day)
        // 2. 2026-04-30 22:00–24:00 (120 min, regular day + night: +25% = 1.25)
        // 3. 2026-05-01 00:00–04:00 (240 min, Holiday + night: +100% + 25% = +125% = 2.25)
        expect(result.intervals).toHaveLength(3);

        expect(result.intervals[1].isHoliday).toBe(false);
        expect(result.intervals[1].rateMultiplier).toBe(1.25);

        expect(result.intervals[2].dateIso).toBe("2026-05-01");
        expect(result.intervals[2].isHoliday).toBe(true);
        expect(result.intervals[2].holidayName).toBe("Tag der Arbeit");
        expect(result.intervals[2].isNight).toBe(true);
        expect(result.intervals[2].rateMultiplier).toBe(2.25); // 1.0 + 1.0 (hol) + 0.25 (night)
      }
    });
  });

  describe("5. Combination Rules: highest_non_night_plus_night vs cumulative", () => {
    it("respects highest_non_night_plus_night when Sunday and Holiday coincide (Easter Sunday night)", () => {
      // 2026-04-05 is Ostersonntag (Easter Sunday)
      // In Brandenburg (BB) and Hessen, or Easter Sunday in general:
      // Policy surcharges: Sun (+50%), Holiday (+100%), Night (+25%)
      const easterPolicy = createTestFrozenPolicy({
        federalState: "BB", // Ostersonntag is statutory public holiday in Brandenburg!
        combinationRule: "highest_non_night_plus_night",
        nightStart: "20:00",
        nightEnd: "06:00",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-easter-highest",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-04-05",
        startTime: "20:00",
        endTime: "00:00", // 4 hours in night window ending at midnight
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 4.0,
          effectiveVersion: "sched:order-06:pqr678",
          source: "scheduled",
        },
        policy: easterPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        // Holiday (+100%) is higher than Sunday (+50%).
        // Highest non-night = Holiday (+100%).
        // Plus night (+25%) = +125% (multiplier 2.25).
        // Sunday is NOT accumulated!
        expect(result.intervals[0].effectiveSurchargeFraction).toBe(1.25);
        expect(result.intervals[0].rateMultiplier).toBe(2.25);
        expect(result.surchargeMinutes.holidayMinutes).toBe(240);
        expect(result.surchargeMinutes.sundayMinutes).toBe(0); // Suppressed by highest rule!
        expect(result.surchargeMinutes.nightMinutes).toBe(240);
      }
    });

    it("respects cumulative rule when explicitly specified in contract", () => {
      const cumulativePolicy = createTestFrozenPolicy({
        federalState: "BB",
        combinationRule: "cumulative",
        nightStart: "20:00",
        nightEnd: "06:00",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-easter-cumulative",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-04-05",
        startTime: "20:00",
        endTime: "00:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 4.0,
          effectiveVersion: "sched:order-07:stu901",
          source: "scheduled",
        },
        policy: cumulativePolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        // Cumulative: Holiday (+100%) + Sunday (+50%) + Night (+25%) = +175% (multiplier 2.75)
        expect(result.intervals[0].effectiveSurchargeFraction).toBe(1.75);
        expect(result.intervals[0].rateMultiplier).toBe(2.75);
        expect(result.surchargeMinutes.holidayMinutes).toBe(240);
        expect(result.surchargeMinutes.sundayMinutes).toBe(240); // Accumulated!
        expect(result.surchargeMinutes.nightMinutes).toBe(240);
      }
    });
  });

  describe("6. Break Handling & Allocation Invariants", () => {
    it("deducts break without ambiguity when entire shift is in a single uniform category", () => {
      // Wednesday 08:00 to 16:30 (8.5h = 510 gross min).
      // breakMinutes: 30 (duration only, no timestamps).
      // Entire shift is daytime weekday.
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-uniform",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:30",
        breakMinutes: 30,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-08:vwx234",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(510);
        expect(result.breakMinutes).toBe(30);
        expect(result.netWorkMinutes).toBe(480);
        expect(result.intervals.reduce((a, b) => a + b.durationMinutes, 0)).toBe(480);
        // Duration-only breaks do not synthesize fake physical intervals
        expect(result.breakIntervals).toHaveLength(0);
      }
    });

    it("returns UNRESOLVED_BREAK_ALLOCATION when break has no timestamps and shift crosses surcharge boundary", () => {
      // Wednesday 18:00 to 22:00 (4h = 240 gross min).
      // 18:00 to 20:00 is Day (rate 1.0).
      // 20:00 to 22:00 is Night (night starts at 20:00, rate 1.25).
      // breakMinutes: 30 (duration only).
      const nightEarlyPolicy = createTestFrozenPolicy({
        nightStart: "20:00",
        nightEnd: "06:00",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-ambiguous",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "18:00",
        endTime: "22:00",
        breakMinutes: 30,
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "sched:order-09:yz0123",
          source: "scheduled",
        },
        policy: nightEarlyPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");

      if (result.status === "unresolved") {
        expect(result.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
        expect(result.message).toContain("Zuschlagskategorie-Grenzen");
      }
    });

    it("resolves cleanly when explicit break window is provided across surcharge boundaries", () => {
      // Shift 18:00 to 22:00 with night starting at 20:00.
      // Break window explicitly defined: 19:30 to 20:00 (in daytime).
      const nightEarlyPolicy = createTestFrozenPolicy({
        nightStart: "20:00",
        nightEnd: "06:00",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-window",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "18:00",
        endTime: "22:00",
        breakWindows: [{ start: "19:30", end: "20:00" }],
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "corr:req-01:r1:abc",
          source: "approved_correction",
        },
        policy: nightEarlyPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(240);
        expect(result.breakMinutes).toBe(30);
        expect(result.netWorkMinutes).toBe(210);

        // Day interval: 18:00 to 19:30 = 90 min (1.0x)
        // Night interval: 20:00 to 22:00 = 120 min (1.25x)
        expect(result.intervals).toHaveLength(2);
        expect(result.intervals[0].startTime).toBe("18:00");
        expect(result.intervals[0].endTime).toBe("19:30");
        expect(result.intervals[0].durationMinutes).toBe(90);
        expect(result.intervals[0].isNight).toBe(false);

        expect(result.intervals[1].startTime).toBe("20:00");
        expect(result.intervals[1].endTime).toBe("22:00");
        expect(result.intervals[1].durationMinutes).toBe(120);
        expect(result.intervals[1].isNight).toBe(true);
      }
    });

    it("resolves cleanly when contractual proportional break allocation rule is documented", () => {
      // Shift 18:00 to 22:00 (120 min day, 120 min night), breakMinutes: 30.
      // Contractual rule: "proportional".
      // 50% day / 50% night -> 15 min deducted from day, 15 min from night.
      const nightEarlyPolicy = createTestFrozenPolicy({
        nightStart: "20:00",
        nightEnd: "06:00",
        sourceReference: "Tarifvertrag TVöD-B § 7 Abs. 2",
        clientContractId: "TVöD-B",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-proportional",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "18:00",
        endTime: "22:00",
        breakMinutes: 30,
        contractualBreakAllocationRule: "proportional",
        breakAllocationSourceReference: "Tarifvertrag TVöD-B § 7 Abs. 2",
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "sched:order-10:contractual",
          source: "scheduled",
        },
        policy: nightEarlyPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(240);
        expect(result.breakMinutes).toBe(30);
        expect(result.netWorkMinutes).toBe(210);

        // Net day = 120 - 15 = 105 min
        // Net night = 120 - 15 = 105 min
        expect(result.surchargeMinutes.nightMinutes).toBe(105);
      }
    });

    it("rejects break window located outside shift boundaries", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-outside",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakWindows: [{ start: "16:30", end: "17:00" }],
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-11:outside",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("BREAK_WINDOW_OUTSIDE_SHIFT");
      }
    });

    it("rejects fractional or non-safe-integer break durations upfront with INVALID_BREAK_DURATION", () => {
      const fractionalInput: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-fractional",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0.5,
        effectiveWorkHoursRef: {
          effectiveHours: 7.99,
          effectiveVersion: "sched:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const res1 = splitShiftMinutes(fractionalInput);
      expect(res1.status).toBe("unresolved");
      if (res1.status === "unresolved") {
        expect(res1.code).toBe("INVALID_BREAK_DURATION");
      }

      const nanInput: ShiftMinuteSplitterInput = {
        ...fractionalInput,
        breakMinutes: NaN,
      };
      const res2 = splitShiftMinutes(nanInput);
      expect(res2.status).toBe("unresolved");
      if (res2.status === "unresolved") {
        expect(res2.code).toBe("INVALID_BREAK_DURATION");
      }

      const infInput: ShiftMinuteSplitterInput = {
        ...fractionalInput,
        breakMinutes: Infinity,
      };
      const res3 = splitShiftMinutes(infInput);
      expect(res3.status).toBe("unresolved");
      if (res3.status === "unresolved") {
        expect(res3.code).toBe("INVALID_BREAK_DURATION");
      }

      const negInput: ShiftMinuteSplitterInput = {
        ...fractionalInput,
        breakMinutes: -10,
      };
      const res4 = splitShiftMinutes(negInput);
      expect(res4.status).toBe("unresolved");
      if (res4.status === "unresolved") {
        expect(res4.code).toBe("INVALID_BREAK_DURATION");
      }
    });

    it("rejects invalid effective hours with INVALID_EFFECTIVE_HOURS", () => {
      const nanHoursInput: ShiftMinuteSplitterInput = {
        shiftId: "shift-invalid-eff-hours",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: NaN,
          effectiveVersion: "sched:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const res = splitShiftMinutes(nanHoursInput);
      expect(res.status).toBe("unresolved");
      if (res.status === "unresolved") {
        expect(res.code).toBe("INVALID_EFFECTIVE_HOURS");
      }
    });

    it("rejects proportional break allocation with unverified free text or foreign contract references", () => {
      const nightEarlyPolicy = createTestFrozenPolicy({
        nightStart: "20:00",
        nightEnd: "06:00",
        sourceReference: "Tarifvertrag TVöD-B § 7 Abs. 2",
        clientContractId: "TVöD-B",
      });

      // 1. Missing source reference
      const inputNoRef: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-prop-no-ref",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "18:00",
        endTime: "22:00",
        breakMinutes: 30,
        contractualBreakAllocationRule: "proportional",
        breakAllocationSourceReference: undefined,
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "sched:order-10:contractual",
          source: "scheduled",
        },
        policy: nightEarlyPolicy,
      };
      const res1 = splitShiftMinutes(inputNoRef);
      expect(res1.status).toBe("unresolved");
      if (res1.status === "unresolved") {
        expect(res1.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
      }

      // 2. Random unverified free text
      const inputRandomRef: ShiftMinuteSplitterInput = {
        ...inputNoRef,
        breakAllocationSourceReference: "Random unverified verbal agreement",
      };
      const res2 = splitShiftMinutes(inputRandomRef);
      expect(res2.status).toBe("unresolved");
      if (res2.status === "unresolved") {
        expect(res2.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
      }

      // 3. Foreign client contract reference
      const inputForeignRef: ShiftMinuteSplitterInput = {
        ...inputNoRef,
        breakAllocationSourceReference: "contract-different-client-99",
      };
      const res3 = splitShiftMinutes(inputForeignRef);
      expect(res3.status).toBe("unresolved");
      if (res3.status === "unresolved") {
        expect(res3.code).toBe("UNRESOLVED_BREAK_ALLOCATION");
      }
    });

    it("accepts a physically valid break spanning the autumn repeated hour in UTC", () => {
      // 2026-10-25: 00:30Z to 02:30Z (120 minutes)
      // Break: 00:45Z to 01:00Z (15 minutes across 01:00Z which is 02:00 CET/CEST transition)
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-autumn-break-span",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-10-25T00:30:00Z",
        endDateTime: "2026-10-25T02:30:00Z",
        breakWindows: [{ start: "2026-10-25T00:45:00Z", end: "2026-10-25T01:00:00Z" }],
        effectiveWorkHoursRef: {
          effectiveHours: 1.75,
          effectiveVersion: "sched:order-dst-span",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(120);
        expect(result.breakMinutes).toBe(15);
        expect(result.netWorkMinutes).toBe(105);
        expect(result.breakIntervals).toHaveLength(1);
        expect(result.breakIntervals[0].durationMinutes).toBe(15);
      }
    });

    it("accepts a break strictly inside the second duplicate autumn hour in UTC", () => {
      // 01:15Z to 01:30Z is strictly within the 2nd duplicate hour (02:15 CET to 02:30 CET)
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-autumn-break-second-hour",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-10-25T00:30:00Z",
        endDateTime: "2026-10-25T02:30:00Z",
        breakWindows: [{ start: "2026-10-25T01:15:00Z", end: "2026-10-25T01:30:00Z" }],
        effectiveWorkHoursRef: {
          effectiveHours: 1.75,
          effectiveVersion: "sched:order-dst-second",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(120);
        expect(result.breakMinutes).toBe(15);
        expect(result.netWorkMinutes).toBe(105);
      }
    });

    it("rejects overlapping break windows in UTC timestamps", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-overlap-utc",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-10-25T00:00:00Z",
        endDateTime: "2026-10-25T04:00:00Z",
        breakWindows: [
          { start: "2026-10-25T01:00:00Z", end: "2026-10-25T02:00:00Z" },
          { start: "2026-10-25T01:30:00Z", end: "2026-10-25T02:30:00Z" },
        ],
        effectiveWorkHoursRef: {
          effectiveHours: 2.0,
          effectiveVersion: "sched:overlap",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("OVERLAPPING_BREAK_WINDOWS");
      }
    });

    it("rejects break window located outside shift boundaries in UTC timestamps", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-outside-utc",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-10-25T00:00:00Z",
        endDateTime: "2026-10-25T03:00:00Z",
        breakWindows: [{ start: "2026-10-25T03:15:00Z", end: "2026-10-25T03:45:00Z" }],
        effectiveWorkHoursRef: {
          effectiveHours: 2.5,
          effectiveVersion: "sched:outside-utc",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("BREAK_WINDOW_OUTSIDE_SHIFT");
      }
    });
  });

  describe("7. Daylight Saving Time (DST) Gap & Ambiguity Handling", () => {
    it("flags non-existent local time during Spring-forward gap (02:00–02:59) with DST_GAP", () => {
      // 2026-03-29 is Spring-forward Sunday in Germany.
      // 02:30 does NOT exist in Europe/Berlin (clocks jump from 02:00 CET to 03:00 CEST).
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-dst-gap",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-03-29",
        startTime: "02:30", // Non-existent time!
        endTime: "06:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "sched:order-dst-1:gap",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("DST_GAP");
        expect(result.message).toContain("Sommerzeit-Umstellungslücke");
      }
    });

    it("flags ambiguous local time during Fall-back duplicate hour (02:00–02:59) with DST_AMBIGUOUS", () => {
      // 2026-10-25 is Fall-back Sunday in Germany.
      // 02:30 occurs twice in Europe/Berlin (2A in CEST and 2B in CET).
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-dst-ambiguous",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-10-25",
        startTime: "02:30", // Ambiguous without offset!
        endTime: "06:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 3.5,
          effectiveVersion: "sched:order-dst-2:ambig",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("DST_AMBIGUOUS");
        expect(result.message).toContain("mehrdeutig");
      }
    });
  });

  describe("8. Policy Expiration & Unresolved Statutory Municipalities", () => {
    it("fails when shift date is beyond policy effectiveTo (POLICY_UNRESOLVED / POLICY_EXPIRED)", () => {
      // Shift on 2027-01-05 (defaultPolicy expires on 2026-12-31)
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-expired-policy",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2027-01-05",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-exp:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("POLICY_UNRESOLVED");
        expect(result.diagnostics.underlyingPolicyCode).toBe("POLICY_EXPIRED");
      }
    });

    it("fails when statutory holiday is unresolved (Bavarian municipality without Catholic consensus)", () => {
      // Bavaria on August 15 (Mariä Himmelfahrt) with undefined municipality
      const bavarianPolicy = createTestFrozenPolicy({
        federalState: "BY",
        municipality: null, // Undefined municipality!
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-bavaria-ambiguous",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-08-15",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-by:v1",
          source: "scheduled",
        },
        policy: bavarianPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("POLICY_UNRESOLVED");
        expect(result.diagnostics.underlyingPolicyCode).toBe("AMBIGUOUS_MUNICIPAL_LOCATION");
      }
    });
  });

  describe("9. Worker Collisions & Display Safety", () => {
    it("distinguishes workers with identical full names by workerId strictly", () => {
      const workerAInput: ShiftMinuteSplitterInput = {
        shiftId: "shift-worker-a",
        workerId: "worker-id-1001",
        workerName: "Max Mustermann",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-wa:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const workerBInput: ShiftMinuteSplitterInput = {
        shiftId: "shift-worker-b",
        workerId: "worker-id-1002",
        workerName: "Max Mustermann", // Same full name!
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-wb:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const resA = splitShiftMinutes(workerAInput);
      const resB = splitShiftMinutes(workerBInput);

      expect(resA.status).toBe("resolved");
      expect(resB.status).toBe("resolved");

      if (resA.status === "resolved" && resB.status === "resolved") {
        expect(resA.workerId).toBe("worker-id-1001");
        expect(resB.workerId).toBe("worker-id-1002");
        expect(resA.preparedLineItems[0].workerId).toBe("worker-id-1001");
        expect(resB.preparedLineItems[0].workerId).toBe("worker-id-1002");
      }
    });
  });

  describe("10. Zero Database Mutation Guarantee (Read-Only Isolation)", () => {
    it("proves that executing splitShiftMinutes and splitAssignmentMinutesFromEffective executes 0 DB writes", async () => {
      // Mock prisma mutation methods
      const invoiceCreateSpy = vi.spyOn(prisma.invoice, "create").mockImplementation(() => {
        throw new Error("UNEXPECTED_DB_WRITE: invoice.create");
      });
      const invoiceUpdateSpy = vi.spyOn(prisma.invoice, "update").mockImplementation(() => {
        throw new Error("UNEXPECTED_DB_WRITE: invoice.update");
      });
      const confirmationUpdateSpy = vi.spyOn(prisma.serviceConfirmation, "update").mockImplementation(() => {
        throw new Error("UNEXPECTED_DB_WRITE: serviceConfirmation.update");
      });

      // Mock prisma read for an assignment
      const mockTx = {
        assignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "assignment-ro-01",
            worker: { id: "worker-ro-01", fullName: "Klaus Berger" },
            order: {
              id: "order-ro-01",
              shiftDate: new Date("2026-06-10T00:00:00Z"),
              clientId: "client-test-01",
              client: { facilityName: "Seniorenresidenz Ahrblick" },
              startTime: "08:00",
              endTime: "16:00",
              breakMinutes: 30,
            },
            serviceConfirmation: null,
          }),
        },
        workHoursCorrectionRequest: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await splitAssignmentMinutesFromEffective({
        assignmentId: "assignment-ro-01",
        policy: defaultPolicy,
        clientOrTx: mockTx,
      });

      expect(result.status).toBe("resolved");
      expect(invoiceCreateSpy).not.toHaveBeenCalled();
      expect(invoiceUpdateSpy).not.toHaveBeenCalled();
      expect(confirmationUpdateSpy).not.toHaveBeenCalled();

      invoiceCreateSpy.mockRestore();
      invoiceUpdateSpy.mockRestore();
      confirmationUpdateSpy.mockRestore();
    });
  });

  describe("11. Corrected Work Hours (Phase 3c) vs Scheduled Hours Precedence", () => {
    it("uses approved corrected times and break rather than scheduled order times", async () => {
      // Order scheduled: 08:00 to 16:00 (8h), break 30 min -> net 7.5h (450 min)
      // Approved correction: 08:00 to 14:00 (6h), break 0 min -> net 6.0h (360 min)
      const mockTx = {
        assignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "assignment-corr-01",
            worker: { id: "worker-01", fullName: "Anna Schmidt" },
            order: {
              id: "order-scheduled-01",
              shiftDate: new Date("2026-06-10T00:00:00Z"),
              clientId: "client-test-01",
              client: { facilityName: "Seniorenresidenz Ahrblick" },
              startTime: "08:00",
              endTime: "16:00",
              breakMinutes: 30,
            },
            serviceConfirmation: null,
          }),
        },
        workHoursCorrectionRequest: {
          findFirst: vi.fn().mockResolvedValue({
            id: "corr-req-approved-01",
            assignmentId: "assignment-corr-01",
            documentId: "doc-evidence-01",
            baseVersion: "sched:order-scheduled-01:token",
            revision: 2,
            status: "approved",
            proposedHoursWorked: 6.0,
            proposedStartTime: "08:00",
            proposedEndTime: "14:00",
            proposedBreakMinutes: 0,
            reason: "Kunde schickte Mitarbeiter früher nach Hause laut Dienstzettel",
            requestedById: "admin-01",
            requestedAt: new Date("2026-06-11T10:00:00Z"),
            decidedById: "admin-02",
            decidedAt: new Date("2026-06-11T12:00:00Z"),
            decisionNote: "Genehmigt gemäß Stundenzettel",
          }),
        },
      };

      const result = await splitAssignmentMinutesFromEffective({
        assignmentId: "assignment-corr-01",
        policy: defaultPolicy,
        clientOrTx: mockTx,
      });

      expect(result.status).toBe("resolved");
      if (result.status === "resolved") {
        // Must reflect corrected 6.0h = 360 min (08:00 to 14:00), NOT 7.5h (450 min)
        expect(result.netWorkMinutes).toBe(360);
        expect(result.grossShiftMinutes).toBe(360);
        expect(result.breakMinutes).toBe(0);
        expect(result.effectiveHoursSource).toBe("approved_correction");
        expect(result.effectiveHoursVersion).toContain("corr:corr-req-approved-01:r2");
        expect(result.intervals).toHaveLength(1);
        expect(result.intervals[0].startTime).toBe("08:00");
        expect(result.intervals[0].endTime).toBe("14:00");
      }
    });
  });

  describe("12. Month & Year Boundary Rollover Invariants", () => {
    it("partitions an overnight shift crossing month boundary (2026-06-30 to 2026-07-01)", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-month-boundary",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-30",
        startTime: "20:00",
        endTime: "04:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-mb:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.intervals).toHaveLength(3);
        // Interval 1: 2026-06-30 20:00–22:00
        expect(result.intervals[0].dateIso).toBe("2026-06-30");
        // Interval 2: 2026-06-30 22:00–24:00
        expect(result.intervals[1].dateIso).toBe("2026-06-30");
        // Interval 3: 2026-07-01 00:00–04:00 (New month!)
        expect(result.intervals[2].dateIso).toBe("2026-07-01");
        expect(result.intervals[2].startTime).toBe("00:00");
        expect(result.intervals[2].endTime).toBe("04:00");
      }
    });

    it("partitions an overnight shift crossing year boundary (Silvester to Neujahr: 2026-12-31 to 2027-01-01)", () => {
      // Policy covering through 2027
      const yearSpanningPolicy = createTestFrozenPolicy({
        effectiveFrom: "2026-01-01",
        effectiveTo: "2027-12-31",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-year-boundary",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-12-31",
        startTime: "20:00",
        endTime: "04:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:order-yb:v1",
          source: "scheduled",
        },
        policy: yearSpanningPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("resolved");

      if (result.status === "resolved") {
        expect(result.intervals).toHaveLength(3);
        // Silvester day
        expect(result.intervals[0].dateIso).toBe("2026-12-31");
        expect(result.intervals[0].isHoliday).toBe(false);

        // Silvester night
        expect(result.intervals[1].dateIso).toBe("2026-12-31");
        expect(result.intervals[1].isHoliday).toBe(false);

        // Neujahr (2027-01-01, statutory public holiday + night!)
        expect(result.intervals[2].dateIso).toBe("2027-01-01");
        expect(result.intervals[2].isHoliday).toBe(true);
        expect(result.intervals[2].holidayName).toBe("Neujahr");
        expect(result.intervals[2].isNight).toBe(true);
        expect(result.intervals[2].rateMultiplier).toBe(2.25);
      }
    });
  });

  describe("13. Strict Policy Integrity & Rejections", () => {
    it("rejects policy that is not frozen (isFrozen !== true)", () => {
      const unfrozenPolicy = {
        ...defaultPolicy,
        isFrozen: false,
      };

      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-unfrozen",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:v1",
          source: "scheduled",
        },
        policy: unfrozenPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("POLICY_NOT_FROZEN");
      }
    });

    it("rejects client/facility mismatch between shift and policy", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-mismatch",
        workerId: "worker-01",
        clientId: "client-DIFFERENT-02", // Different client!
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "sched:v1",
          source: "scheduled",
        },
        policy: defaultPolicy, // Policy is for client-test-01
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("CLIENT_POLICY_MISMATCH");
      }
    });

    it("rejects missing effective work hours version token", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-no-version",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        effectiveWorkHoursRef: {
          effectiveHours: 8.0,
          effectiveVersion: "", // Missing!
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("MISSING_EFFECTIVE_HOURS_VERSION");
      }
    });

    it("rejects break duration exceeding or equal to gross shift duration", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-break-exceeds",
        workerId: "worker-01",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "12:00", // 4 hours = 240 min
        breakMinutes: 240, // Equal to shift duration!
        effectiveWorkHoursRef: {
          effectiveHours: 0,
          effectiveVersion: "sched:v1",
          source: "scheduled",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("BREAK_EXCEEDS_SHIFT_DURATION");
      }
    });
  });

  describe("14. Integration with Exact Invoice Engine (Pure Adapter Contract)", () => {
    it("converts 60-minute Saturday shift at 40 EUR/h + 25% surcharge to exactly 50.00 EUR without double-billing base", () => {
      // 1-hour Saturday daytime shift
      const input: ShiftMinuteSplitterInput = {
        shiftId: "shift-sat-60min",
        workerId: "worker-01",
        workerName: "Max Mustermann",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-13", // Saturday
        startTime: "10:00",
        endTime: "11:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 1.0,
          effectiveVersion: "conf:order-sat-60",
          source: "service_confirmation",
        },
        policy: defaultPolicy, // surchargeSat: 0.25
      };

      const splitResult = splitShiftMinutes(input);
      expect(splitResult.status).toBe("resolved");
      if (splitResult.status !== "resolved") return;

      expect(splitResult.netWorkMinutes).toBe(60);
      expect(splitResult.preparedLineItems).toHaveLength(2);

      // Verify that PreparedWorkLineItem does not contain priceVersionId
      for (const item of splitResult.preparedLineItems) {
        expect((item as unknown as { priceVersionId?: unknown }).priceVersionId).toBeUndefined();
      }

      // Convert using pure adapter supplying the actual price record version ID and rate (40.00 EUR = 4000 cents)
      const rawLines = convertPreparedItemsToRawInvoiceLines({
        preparedItems: splitResult.preparedLineItems,
        priceVersionId: "price-ver-2026-pfk",
        baseHourlyRateInCents: 4000, // 40.00 EUR/h
      });

      expect(rawLines).toHaveLength(2);
      // Line 1: Base 60 minutes at 4000 cents/h
      expect(rawLines[0].itemCategory).toBe("base");
      expect(rawLines[0].minutes).toBe(60);
      expect((rawLines[0].hourlyRate as { cents: number })?.cents).toBe(4000);

      // Line 2: Surcharge Saturday 60 minutes with baseHourlyRate 4000 and surchargeRatio 0.25
      expect(rawLines[1].itemCategory).toBe("surcharge_saturday");
      expect(rawLines[1].minutes).toBe(60);
      expect((rawLines[1].baseHourlyRate as { cents: number })?.cents).toBe(4000);
      expect(rawLines[1].surchargeRatio).toBe(0.25);
      expect(rawLines[1].deriveSurchargeRate).toBe(true);

      // Run exact calculation engine
      const exactResult = calculateExactInvoice(rawLines, {
        taxRate: 0.19, // 19% VAT
      });

      // Verification of Strict Financial Contract:
      // Base: 1.00 h * 40.00 EUR = 40.00 EUR (4000 cents)
      // Surcharge: 1.00 h * 10.00 EUR (40 * 0.25) = 10.00 EUR (1000 cents)
      // Net Subtotal: exactly 50.00 EUR (5000 cents)
      // If base had been double-counted (40 EUR base + 50 EUR surcharge), total would be 90 EUR.
      expect(exactResult.totals.subtotalCents).toBe(5000);
      expect(exactResult.totals.subtotalDecimal).toBe("50.00");
      expect(exactResult.totals.subtotalDisplay).toBe("50,00 €");

      // 19% VAT on 50.00 EUR = 9.50 EUR (950 cents)
      expect(exactResult.totals.taxAmountCents).toBe(950);
      expect(exactResult.totals.totalCents).toBe(5950);
      expect(exactResult.totals.totalDecimal).toBe("59.50");
      expect(exactResult.totals.totalDisplay).toBe("59,50 €");
    });

    it("rejects convertPreparedItemsToRawInvoiceLines with missing priceVersionId or invalid base rate", () => {
      const mockItems: PreparedWorkLineItem[] = [
        {
          workerId: "w1",
          qualification: "pflegefachkraft",
          itemCategory: "base",
          surchargePolicyId: "pol-1",
          surchargePolicyVersion: 1,
          combinationRule: "highest_non_night_plus_night",
          minutes: 60,
          surchargeFraction: 0,
          descriptionDE: "Grundarbeitszeit",
        },
      ];

      expect(() =>
        convertPreparedItemsToRawInvoiceLines({
          preparedItems: mockItems,
          priceVersionId: "",
          baseHourlyRateInCents: 4000,
        })
      ).toThrow("priceVersionId");

      expect(() =>
        convertPreparedItemsToRawInvoiceLines({
          preparedItems: mockItems,
          priceVersionId: "   ",
          baseHourlyRateInCents: 4000,
        })
      ).toThrow("priceVersionId");

      expect(() =>
        convertPreparedItemsToRawInvoiceLines({
          preparedItems: mockItems,
          priceVersionId: "pv-1",
          baseHourlyRateInCents: -500,
        })
      ).toThrow("baseHourlyRateInCents");

      expect(() =>
        convertPreparedItemsToRawInvoiceLines({
          preparedItems: mockItems,
          priceVersionId: "pv-1",
          baseHourlyRateInCents: 4000.5,
        })
      ).toThrow("baseHourlyRateInCents");
    });
  });

  describe("15. Independent Codex Countertests & Follow-up Probes", () => {
    it("rejects a confirmed hour amount inconsistent with the billable minute span", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "s1",
        workerId: "w1",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-10",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 6, // 6h != 8h
          effectiveVersion: "v1",
          source: "service_confirmation",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("EFFECTIVE_HOURS_MISMATCH");
      }
    });

    it("does not bill 120 minutes for a 60-minute explicit spring DST shift", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "s1",
        workerId: "w1",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-03-29T00:30:00Z",
        endDateTime: "2026-03-29T01:30:00Z",
        effectiveWorkHoursRef: {
          effectiveHours: 1,
          effectiveVersion: "v1",
          source: "service_confirmation",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status === "unresolved" || result.grossShiftMinutes === 60).toBe(true);
      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(60);
      }
    });

    it("does not bill 120 minutes for a 180-minute explicit autumn DST shift", () => {
      const input: ShiftMinuteSplitterInput = {
        shiftId: "s1",
        workerId: "w1",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        startDateTime: "2026-10-24T23:30:00Z",
        endDateTime: "2026-10-25T02:30:00Z",
        effectiveWorkHoursRef: {
          effectiveHours: 3,
          effectiveVersion: "v1",
          source: "service_confirmation",
        },
        policy: defaultPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status === "resolved").toBe(true);
      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(180);
      }
    });

    it("rejects a modified frozen policy whose terms no longer match the hash", () => {
      const tamperedPolicy = {
        ...defaultPolicy,
        surcharges: {
          ...defaultPolicy.surcharges,
          sat: 0.9,
        },
      };

      const input: ShiftMinuteSplitterInput = {
        shiftId: "s1",
        workerId: "w1",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-06-13",
        startTime: "08:00",
        endTime: "16:00",
        breakMinutes: 0,
        effectiveWorkHoursRef: {
          effectiveHours: 8,
          effectiveVersion: "v1",
          source: "service_confirmation",
        },
        policy: tamperedPolicy,
      };

      const result = splitShiftMinutes(input);
      expect(result.status).toBe("unresolved");
      if (result.status === "unresolved") {
        expect(result.code).toBe("POLICY_UNRESOLVED");
        expect(result.diagnostics).toBeDefined();
      }
    });

    it("does not throw or over-allocate breaks across four one-minute profiles", () => {
      const microPolicy = createTestFrozenPolicy({
        nightStart: "23:59",
        nightEnd: "00:01",
        sourceReference: "Tarifvertrag TVöD-B § 7 Abs. 2",
        clientContractId: "TVöD-B",
      });

      const input: ShiftMinuteSplitterInput = {
        shiftId: "s-micro",
        workerId: "w1",
        clientId: "client-test-01",
        qualification: "pflegefachkraft",
        shiftDate: "2026-04-30",
        startTime: "23:58",
        endTime: "00:02",
        breakMinutes: 2,
        contractualBreakAllocationRule: "proportional",
        breakAllocationSourceReference: "Tarifvertrag TVöD-B § 7 Abs. 2",
        effectiveWorkHoursRef: {
          effectiveHours: 0.03,
          effectiveVersion: "v1",
          source: "service_confirmation",
        },
        policy: microPolicy,
      };

      expect(() => splitShiftMinutes(input)).not.toThrow();
      const result = splitShiftMinutes(input);
      if (result.status === "resolved") {
        expect(result.grossShiftMinutes).toBe(4);
        expect(result.breakMinutes).toBe(2);
        expect(result.netWorkMinutes).toBe(2);
      }
    });
  });
});

