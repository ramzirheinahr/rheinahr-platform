// German domestic meal allowance is calendar-day based, never shift based.
// Legacy database values (per_shift / multiple_shifts_only) remain enabled but
// are deliberately interpreted as the compliant per-day mode.
export type MealAllowancePolicy = "none" | "per_day" | "multiple_shifts_only";

// Old `per_shift` records are interpreted as the safe once-per-day policy.
export function normalizeMealAllowancePolicy(type: string | null | undefined): MealAllowancePolicy {
  if (type === "none") return "none";
  if (type === "multiple_shifts_only") return "multiple_shifts_only";
  return "per_day";
}

export type MealAllowanceCandidate = {
  id: string;
  date: string;
  status: string;
  addMealAllowance?: boolean;
  excludeMealAllowance?: boolean;
};

// Select at most one assignment per calendar day. A manual inclusion wins;
// otherwise the first non-excluded shift carries the day's amount visually.
export function dailyMealAllowanceAssignmentIds(
  candidates: MealAllowanceCandidate[],
  policy: MealAllowancePolicy,
): Set<string> {
  const byDate = new Map<string, MealAllowanceCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.status === "declined") continue;
    const day = byDate.get(candidate.date) ?? [];
    day.push(candidate);
    byDate.set(candidate.date, day);
  }

  const selected = new Set<string>();
  for (const day of byDate.values()) {
    const explicit = day.find((candidate) => candidate.addMealAllowance);
    const eligibleByPolicy =
      policy === "per_day" || (policy === "multiple_shifts_only" && day.length >= 2);
    const automatic = eligibleByPolicy
      ? day.find((candidate) => !candidate.excludeMealAllowance)
      : undefined;
    const assignment = explicit ?? automatic;
    if (assignment) selected.add(assignment.id);
  }
  return selected;
}

export function totalDailyMealAllowance(
  rows: { date: string; mealAllowance?: number | null }[],
): number {
  const countedDays = new Set<string>();
  let total = 0;
  for (const row of rows) {
    if (!row.mealAllowance || countedDays.has(row.date)) continue;
    countedDays.add(row.date);
    total += row.mealAllowance;
  }
  return total;
}
