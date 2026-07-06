import { describe, it, expect } from "vitest";
import {
  resolveRates,
  rateFor,
  requestNetTotal,
  shiftCategoryHours,
  netShiftHours,
  resolveNightWindow,
  DEFAULT_SURCHARGES,
  DEFAULT_NIGHT_WINDOW,
  HOURLY_RATES,
} from "./pricing";

const notHoliday = () => false;

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

describe("shiftCategoryHours — per-hour surcharge split", () => {
  it("weekday overnight shift is all night hours (20:00–06:00)", () => {
    // 2026-07-06 is a Monday. 20:00 → next-day 06:00 = 10h gross, 0.5h break.
    const cats = shiftCategoryHours("2026-07-06", "20:00", "06:00", 30, notHoliday);
    expect(cats.night).toBeCloseTo(9.5, 5);
    expect(cats.base + cats.sat + cats.sun + cats.holiday).toBeCloseTo(0, 5);
  });

  it("Saturday night splits at midnight → Sunday hours after 00:00", () => {
    // 2026-07-11 is a Saturday. Sat 20:00 → Sun 06:00.
    const cats = shiftCategoryHours("2026-07-11", "20:00", "06:00", 30, notHoliday);
    // Weekend beats night: 4h Saturday + 6h Sunday, break spread proportionally.
    const factor = (600 - 30) / 600;
    expect(cats.sat).toBeCloseTo(4 * factor, 5);
    expect(cats.sun).toBeCloseTo(6 * factor, 5);
    expect(cats.night).toBeCloseTo(0, 5);
  });

  it("category hours always sum to the net shift hours", () => {
    for (const [s, e] of [
      ["06:30", "14:00"],
      ["20:30", "07:00"],
      ["13:30", "21:00"],
    ] as const) {
      const cats = shiftCategoryHours("2026-07-11", s, e, 30, notHoliday);
      const sum = cats.base + cats.sat + cats.sun + cats.holiday + cats.night;
      expect(sum).toBeCloseTo(netShiftHours(s, e), 5);
    }
  });

  it("holiday wins over everything", () => {
    const isHol = (d: string) => d === "2026-07-06";
    const cats = shiftCategoryHours("2026-07-06", "20:00", "23:00", 0, isHol);
    expect(cats.holiday).toBeCloseTo(3, 5);
    expect(cats.night).toBeCloseTo(0, 5);
  });
});

describe("requestNetTotal — night surcharge", () => {
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
