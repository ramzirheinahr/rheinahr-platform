import { describe, expect, it } from "vitest";
import { dailyMealAllowanceAssignmentIds, totalDailyMealAllowance } from "./meal-allowance";

describe("daily meal allowance", () => {
  it("selects only one shift when a worker has multiple shifts on one day", () => {
    const selected = dailyMealAllowanceAssignmentIds([
      { id: "early", date: "2026-08-12", status: "confirmed" },
      { id: "late", date: "2026-08-12", status: "confirmed" },
    ], true);
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
    ], true);
    expect([...selected]).toEqual(["manual"]);
  });
});
