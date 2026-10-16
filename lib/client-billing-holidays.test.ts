import { describe, expect, it } from "vitest";
import {
  billingHolidayAtMinute,
  billingHolidaysForYear,
  defaultBillingHolidays,
  parseBillingHolidayCalendar,
  validateBillingHolidays,
} from "./client-billing-holidays";
import { shiftSurchargeHours } from "./pricing";
import { evaluateMinuteSurcharges, type ResolvedSurchargePolicySuccess } from "./surcharge-policy";

describe("client invoice holiday calendar", () => {
  it("starts with NRW holidays for each year and leaves Christmas Eve optional", () => {
    const calendar = parseBillingHolidayCalendar(null);
    const rows2026 = billingHolidaysForYear(calendar, 2026);
    const rows2027 = billingHolidaysForYear(calendar, 2027);
    expect(rows2026.find((row) => row.date === "2026-11-01")?.active).toBe(true);
    expect(rows2026.find((row) => row.date === "2026-12-24")?.active).toBe(false);
    expect(rows2027.some((row) => row.date.startsWith("2026"))).toBe(false);
  });

  it("bills only the client's selected minutes, not the facility's state", () => {
    const rows = validateBillingHolidays(2026, [
      { date: "2026-12-24", name: "Heiligabend", start: "14:00", end: "24:00", active: true },
    ]);
    expect(billingHolidayAtMinute(rows, "2026-12-24", 13 * 60 + 59)).toBeNull();
    expect(billingHolidayAtMinute(rows, "2026-12-24", 14 * 60)?.name).toBe("Heiligabend");
    expect(billingHolidayAtMinute(rows, "2026-12-25", 0)).toBeNull();
    const split = shiftSurchargeHours("2026-12-24", "13:00", "15:00", 0,
      (date, minute) => Boolean(billingHolidayAtMinute(rows, date, minute)));
    expect(split.get("base")?.hours).toBe(1);
    expect(split.get("holiday")?.hours).toBe(1);
  });

  it("persists deletion as an explicit year and rejects overlap or invalid time", () => {
    const calendar = parseBillingHolidayCalendar({ version: 1, years: { "2026": [] } });
    expect(billingHolidaysForYear(calendar, 2026)).toEqual([]);
    expect(billingHolidaysForYear(calendar, 2027)).toEqual(defaultBillingHolidays(2027));
    expect(() => validateBillingHolidays(2026, [
      { date: "2026-12-24", name: "A", start: "00:00", end: "14:00", active: true },
      { date: "2026-12-24", name: "B", start: "13:00", end: "24:00", active: true },
    ])).toThrow(/Überlappende/);
    expect(() => validateBillingHolidays(2026, [
      { date: "2026-12-24", name: "A", start: "14:00", end: "00:00", active: true },
    ])).toThrow(/Uhrzeit/);
  });

  it("the V2 minute evaluator uses client windows rather than the policy's location", () => {
    const rows = [{ date: "2026-12-24", name: "Heiligabend", start: "14:00", end: "24:00", active: true }];
    const policy: ResolvedSurchargePolicySuccess = {
      status: "resolved", policyId: "policy-1", policyVersion: 1, clientId: "client-1", clientContractId: null,
      federalState: "BY", federalStateNameDE: "Bayern", municipality: null, districtLocality: null,
      surcharges: { sat: 0.25, sun: 0.5, holiday: 1, night: 0.25 },
      nightWindow: { start: "20:00", end: "06:00" }, combinationRule: "highest_non_night_plus_night",
      sourceType: "setting", sourceReference: "Kundenprofil", verifiedByUserId: null, verifiedAt: null,
      effectiveFrom: "2026-01-01", effectiveTo: null, isFrozen: true, frozenHash: "test",
      billingHolidayRows: { "2026": rows },
    };
    const before = evaluateMinuteSurcharges("2026-12-24", 13 * 60 + 59, policy);
    const after = evaluateMinuteSurcharges("2026-12-24", 14 * 60, policy);
    expect(before.status === "resolved" && before.isHoliday).toBe(false);
    expect(after.status === "resolved" && after.isHoliday).toBe(true);
    expect(after.status === "resolved" && after.holidayRecord?.name).toBe("Heiligabend");
  });
});
