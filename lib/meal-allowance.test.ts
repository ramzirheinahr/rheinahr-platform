import { describe, expect, it } from "vitest";
import { dailyMealAllowanceAssignmentIds, totalDailyMealAllowance } from "./meal-allowance";

describe("daily meal allowance", () => {
  it("selects only one shift when a worker has multiple shifts on one day", () => {
    const selected = dailyMealAllowanceAssignmentIds([
      { id: "early", date: "2026-08-12", status: "confirmed" },
      { id: "late", date: "2026-08-12", status: "confirmed" },
    ], "per_day");
    expect([...selected]).toEqual(["early"]);
  });

  it("does not select a single shift for the multiple-shifts-only policy", () => {
    const selected = dailyMealAllowanceAssignmentIds([
      { id: "only", date: "2026-08-12", status: "confirmed" },
    ], "multiple_shifts_only");
    expect([...selected]).toEqual([]);
  });

  it("selects exactly one shift when the multiple-shifts-only condition is met", () => {
    const selected = dailyMealAllowanceAssignmentIds([
      { id: "early", date: "2026-08-12", status: "confirmed" },
      { id: "late", date: "2026-08-12", status: "confirmed" },
    ], "multiple_shifts_only");
    expect([...selected]).toEqual(["early"]);
  });

  it("pays no more than one daily amount even if legacy rows contain it per shift", () => {
    expect(totalDailyMealAllowance([
      { date: "2026-08-12", mealAllowance: 14 },
      { date: "2026-08-12", mealAllowance: 14 },
      { date: "2026-08-13", mealAllowance: 14 },
    ])).toBe(28);
  });

  it("respects exclusion and allows one explicit exception", () => {
    const selected = dailyMealAllowanceAssignmentIds([
      { id: "excluded", date: "2026-08-12", status: "confirmed", excludeMealAllowance: true },
      { id: "manual", date: "2026-08-12", status: "confirmed", addMealAllowance: true },
    ], "per_day");
    expect([...selected]).toEqual(["manual"]);
  });
});
