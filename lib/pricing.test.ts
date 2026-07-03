import { describe, it, expect } from "vitest";
import { resolveRates, rateFor, requestNetTotal, HOURLY_RATES } from "./pricing";

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
