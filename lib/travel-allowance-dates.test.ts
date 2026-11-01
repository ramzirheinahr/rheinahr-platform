import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isTravelEligible } from "./travel-allowance-snapshot";

describe("isTravelEligible", () => {
  const baseWorker = {
    travelAllowanceEnabled: true,
    travelAllowanceValidFrom: new Date("2026-11-05T00:00:00Z"),
    travelAllowanceValidUntil: new Date("2026-11-20T00:00:00Z"),
  };

  it("returns true when shift is within valid date range", () => {
    expect(
      isTravelEligible(baseWorker, { excludeTravelAllowance: false }, new Date("2026-11-10T08:00:00Z")),
    ).toBe(true);
  });

  it("returns false when shift is before validFrom date", () => {
    expect(
      isTravelEligible(baseWorker, { excludeTravelAllowance: false }, new Date("2026-11-04T08:00:00Z")),
    ).toBe(false);
  });

  it("returns false when shift is after validUntil date", () => {
    expect(
      isTravelEligible(baseWorker, { excludeTravelAllowance: false }, new Date("2026-11-21T08:00:00Z")),
    ).toBe(false);
  });

  it("allows explicit per-shift override (addTravelAllowance) even if outside date range or globally disabled", () => {
    expect(
      isTravelEligible(
        { travelAllowanceEnabled: false },
        { excludeTravelAllowance: false, addTravelAllowance: true },
        new Date("2026-11-01T08:00:00Z"),
      ),
    ).toBe(true);

    expect(
      isTravelEligible(
        baseWorker,
        { excludeTravelAllowance: false, addTravelAllowance: true },
        new Date("2026-11-01T08:00:00Z"),
      ),
    ).toBe(true);
  });

  it("allows explicit per-shift exclude (excludeTravelAllowance) even if inside date range", () => {
    expect(
      isTravelEligible(
        baseWorker,
        { excludeTravelAllowance: true },
        new Date("2026-11-10T08:00:00Z"),
      ),
    ).toBe(false);
  });
});
