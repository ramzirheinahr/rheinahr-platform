import { describe, it, expect } from "vitest";
import {
  resolveRates,
  rateFor,
  requestNetTotal,
  shiftSurchargeHours,
  comboMultiplier,
  netShiftHours,
  getShiftDstDeltaMinutes,
  resolveNightWindow,
  DEFAULT_SURCHARGES,
  DEFAULT_NIGHT_WINDOW,
  HOURLY_RATES,
  type SurchargeComponent,
} from "./pricing";

const notHoliday = () => false;

// Sum of net hours across all surcharge groups of a shift.
function totalHours(groups: Map<string, { components: SurchargeComponent[]; hours: number }>) {
  return [...groups.values()].reduce((s, g) => s + g.hours, 0);
}
// Net hours whose combined multiplier equals the given components' sum.
function hoursFor(
  groups: Map<string, { components: SurchargeComponent[]; hours: number }>,
  key: string,
) {
  return groups.get(key)?.hours ?? 0;
}

describe("resolveRates", () => {
  it("no client → platform defaults", () => {
    expect(resolveRates(null)).toEqual(HOURLY_RATES);
    expect(resolveRates(undefined)).toEqual(HOURLY_RATES);
  });

  it("default rates match the agreed values", () => {
    expect(HOURLY_RATES.pflegefachkraft).toBe(54.9);
    expect(HOURLY_RATES.pflegehelfer).toBe(36.9);
    expect(HOURLY_RATES.betreuungskraft).toBe(39.9);
    expect(HOURLY_RATES.pflegedienstleitung).toBe(64.9);
    expect(HOURLY_RATES.kuechenhilfe).toBe(36.9);
    expect(HOURLY_RATES.hausmeister).toBe(36.9);
  });

  it("applies only the overridden qualifications", () => {
    const r = resolveRates({ hourlyRates: { pflegefachkraft: 60, pflegehelfer: 40 } });
    expect(r.pflegefachkraft).toBe(60);
    expect(r.pflegehelfer).toBe(40);
    expect(r.betreuungskraft).toBe(HOURLY_RATES.betreuungskraft); // untouched
  });

  it("ignores malformed override values", () => {
    const r = resolveRates({ hourlyRates: { pflegefachkraft: "x", pflegehelfer: -5 } });
    expect(r.pflegefachkraft).toBe(HOURLY_RATES.pflegefachkraft);
    expect(r.pflegehelfer).toBe(HOURLY_RATES.pflegehelfer);
  });
});

describe("rateFor with client rates", () => {
  it("uses the resolved client rate", () => {
    const rates = resolveRates({ hourlyRates: { pflegefachkraft: 70 } });
    expect(rateFor("pflegefachkraft", rates)).toBe(70);
    expect(rateFor("betreuungskraft", rates)).toBe(HOURLY_RATES.betreuungskraft);
  });
});

describe("requestNetTotal honours client rates", () => {
  const shift = {
    shiftDate: new Date("2026-07-06T00:00:00Z"), // a Monday (no surcharge)
    startTime: "06:30",
    endTime: "14:00", // 7.5h - 0.5h break = 7h net
    quantity: 1,
    requiredQualification: "pflegefachkraft",
  };

  it("default rate", () => {
    expect(requestNetTotal([shift])).toBeCloseTo(7 * 54.9, 5);
  });

  it("overridden rate", () => {
    const rates = resolveRates({ hourlyRates: { pflegefachkraft: 60 } });
    expect(requestNetTotal([shift], undefined, rates)).toBeCloseTo(7 * 60, 5);
  });
});

describe("shiftSurchargeHours — per-hour surcharge grouping (summed model)", () => {
  it("weekday overnight shift is all night hours (20:00–06:00)", () => {
    // 2026-07-06 is a Monday. 20:00 → next-day 06:00 = 10h gross, 0.5h break.
    const g = shiftSurchargeHours("2026-07-06", "20:00", "06:00", 30, notHoliday);
    expect(hoursFor(g, "night")).toBeCloseTo(9.5, 5);
    expect(totalHours(g)).toBeCloseTo(9.5, 5);
  });

  it("Saturday night splits at midnight and STACKS with night", () => {
    // 2026-07-11 is a Saturday. Sat 20:00 → Sun 06:00.
    const g = shiftSurchargeHours("2026-07-11", "20:00", "06:00", 30, notHoliday);
    // Break is placed at the middle of the shift (00:45–01:15 Sunday),
    // so Saturday night has no break (4h) and Sunday night has 0.5h break deducted (5.5h).
    expect(hoursFor(g, "sat+night")).toBeCloseTo(4, 5);
    expect(hoursFor(g, "sun+night")).toBeCloseTo(5.5, 5);
    // Sunday-night hour multiplier = 1 + 0.5 + 0.25 = 1.75.
    expect(comboMultiplier(g.get("sun+night")!.components, DEFAULT_SURCHARGES)).toBeCloseTo(
      1.75,
      5,
    );
    expect(comboMultiplier(g.get("sat+night")!.components, DEFAULT_SURCHARGES)).toBeCloseTo(
      1.5,
      5,
    );
  });

  it("grouped hours always sum to the net shift hours", () => {
    for (const [s, e] of [
      ["06:30", "14:00"],
      ["20:30", "07:00"],
      ["13:30", "21:00"],
    ] as const) {
      const g = shiftSurchargeHours("2026-07-11", s, e, 30, notHoliday);
      expect(totalHours(g)).toBeCloseTo(netShiftHours(s, e), 5);
    }
  });

  it("holiday on a Sunday STACKS (sun + holiday)", () => {
    const isHol = (d: string) => d === "2026-07-12"; // 2026-07-12 is a Sunday
    const g = shiftSurchargeHours("2026-07-12", "10:00", "13:00", 0, isHol);
    expect(hoursFor(g, "holiday+sun")).toBeCloseTo(3, 5);
    // 1 + 1.0 (holiday) + 0.5 (sun) = 2.5.
    expect(comboMultiplier(g.get("holiday+sun")!.components, DEFAULT_SURCHARGES)).toBeCloseTo(
      2.5,
      5,
    );
  });
});

describe("requestNetTotal — summed surcharges", () => {
  it("weekday night shift bills the night surcharge", () => {
    const shift = {
      shiftDate: new Date("2026-07-06T00:00:00Z"), // Monday
      startTime: "20:00",
      endTime: "06:00",
      quantity: 1,
      requiredQualification: "pflegehelfer",
    };
    // 9.5 net hours, all night, +25 %.
    const expected = 9.5 * HOURLY_RATES.pflegehelfer * (1 + DEFAULT_SURCHARGES.night);
    expect(requestNetTotal([shift])).toBeCloseTo(expected, 5);
  });

  it("midday Sunday shift bills the Sunday surcharge (holiday stacking tested above)", () => {
    const shift = {
      shiftDate: new Date("2026-07-12T00:00:00Z"), // Sunday, midday (no night)
      startTime: "10:00",
      endTime: "13:00", // 3h gross − 0.5h default break = 2.5h net
      quantity: 1,
      requiredQualification: "pflegefachkraft",
    };
    const expected = 2.5 * HOURLY_RATES.pflegefachkraft * (1 + DEFAULT_SURCHARGES.sun);
    expect(requestNetTotal([shift])).toBeCloseTo(expected, 5);
  });
});

describe("resolveNightWindow", () => {
  it("falls back to the default window", () => {
    expect(resolveNightWindow(null)).toEqual(DEFAULT_NIGHT_WINDOW);
    expect(resolveNightWindow({ nightStart: "22:00", nightEnd: "05:00" })).toEqual({
      start: "22:00",
      end: "05:00",
    });
  });
});

describe("DST transition handling (Winterzeit & Sommerzeit)", () => {
  it("adds +1 hour during Winterzeit transition in October", () => {
    // 2026-10-24 night shift to 2026-10-25 (tonight)
    const net = netShiftHours("20:45", "06:45", 45, "2026-10-24");
    expect(net).toBe(10.25);
    const delta = getShiftDstDeltaMinutes("2026-10-24", "20:45", "06:45");
    expect(delta).toBe(60);
  });

  it("subtracts -1 hour during Sommerzeit transition in March", () => {
    // 2026-03-28 night shift to 2026-03-29
    const net = netShiftHours("20:45", "06:45", 45, "2026-03-28");
    expect(net).toBe(8.25);
    const delta = getShiftDstDeltaMinutes("2026-03-28", "20:45", "06:45");
    expect(delta).toBe(-60);
  });

  it("calculates standard duration on normal days without DST change", () => {
    const net = netShiftHours("20:45", "06:45", 45, "2026-10-23");
    expect(net).toBe(9.25);
    const delta = getShiftDstDeltaMinutes("2026-10-23", "20:45", "06:45");
    expect(delta).toBe(0);
  });
});

