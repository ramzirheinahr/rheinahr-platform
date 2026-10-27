import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Worker Daily Adjustments & Bonus Hours Calculation", () => {
  it("parses [date:YYYY-MM-DD] tags correctly into daily adjustments", () => {
    const adjustments = [
      { id: "adj-1", month: "2026-10", hours: 4, notes: "[date:2026-10-15]" },
      { id: "adj-2", month: "2026-10", hours: -2, notes: "[date:2026-10-20]" },
      { id: "adj-3", month: "2026-10", hours: 10, notes: "Monthly generic adjustment" },
    ];

    const dailyAdjustments = adjustments
      .map((a) => {
        const match = a.notes?.match(/\[date:([^\]]+)\]/);
        const date = match ? match[1] : "";
        return {
          id: a.id,
          date,
          hours: a.hours,
          notes: a.notes,
        };
      })
      .filter((a) => Boolean(a.date));

    expect(dailyAdjustments).toHaveLength(2);
    expect(dailyAdjustments[0]).toEqual({
      id: "adj-1",
      date: "2026-10-15",
      hours: 4,
      notes: "[date:2026-10-15]",
    });
    expect(dailyAdjustments[1]).toEqual({
      id: "adj-2",
      date: "2026-10-20",
      hours: -2,
      notes: "[date:2026-10-20]",
    });
  });

  it("calculates totals, worked (Ist), and remaining (Kontostand) with bonus hours and daily adjustments", () => {
    const assignments = [
      { id: "a1", confirmedHours: 6, bonusHours: 4, status: "confirmed", scheduledHours: 6 },
      { id: "a2", confirmedHours: 8, bonusHours: -1, status: "confirmed", scheduledHours: 8 },
      { id: "a3", confirmedHours: null, bonusHours: 0, status: "confirmed", scheduledHours: 7.5 }, // accepted
    ];
    const leaveDays = [
      { id: "l1", status: "approved" as const, hours: 7 },
    ];
    const dailyAdjustments = [
      { id: "d1", date: "2026-10-05", hours: 2, notes: "[date:2026-10-05]" },
      { id: "d2", date: "2026-10-12", hours: -3, notes: "[date:2026-10-12]" },
    ];

    const confirmed = assignments.filter((a) => a.confirmedHours != null);
    const leaves = leaveDays.filter((l) => l.status === "approved" && l.hours != null);
    const accepted = assignments.filter(
      (a) => a.status === "confirmed" && a.confirmedHours == null && a.scheduledHours != null,
    );
    const bonusHoursSum = assignments.reduce((sum, a) => sum + (a.bonusHours ?? 0), 0);
    const dailyAdjSum = dailyAdjustments.reduce((sum, d) => sum + (d.hours ?? 0), 0);
    const totalBonusHours = Math.round((bonusHoursSum + dailyAdjSum) * 100) / 100;

    const totals = {
      hours:
        confirmed.reduce((sum, a) => sum + (a.confirmedHours ?? 0), 0) +
        leaves.reduce((sum, l) => sum + (l.hours ?? 0), 0),
      shifts: confirmed.length,
      acceptedHours: accepted.reduce((sum, a) => sum + (a.scheduledHours ?? 0), 0),
      acceptedShifts: accepted.length,
      bonusHours: totalBonusHours,
    };

    expect(totals.hours).toBe(6 + 8 + 7); // 21
    expect(totals.acceptedHours).toBe(7.5);
    // bonusHoursSum = 4 + (-1) = 3. dailyAdjSum = 2 + (-3) = -1. totalBonusHours = 2.
    expect(totals.bonusHours).toBe(2);

    const carryoverHours = -100;
    const requiredHours = 150;

    const worked = Math.round((totals.acceptedHours + totals.hours + totals.bonusHours) * 100) / 100;
    const remaining = Math.round((worked + carryoverHours - requiredHours) * 100) / 100;

    expect(worked).toBe(30.5); // 21 + 7.5 + 2
    expect(remaining).toBe(-219.5); // 30.5 - 100 - 150
  });
});
