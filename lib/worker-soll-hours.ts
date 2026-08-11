export interface WorkerSollHoursRecord {
  validFrom: string; // "YYYY-MM"
  monthlyHours: number;
}

/**
 * Returns the effective monthly required hours (Soll-Stunden) for a given month.
 * It finds the most recent valid record in the history that starts on or before the target month.
 * If no such record exists, it falls back to the base required hours.
 */
export function getEffectiveSollHours(
  targetMonthStr: string, // "YYYY-MM"
  baseRequiredHours: number,
  history?: WorkerSollHoursRecord[]
): number {
  if (!history || history.length === 0) {
    return baseRequiredHours;
  }

  // Sort descending by validFrom so the latest applicable period comes first
  const sorted = [...history].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  
  const active = sorted.find((h) => h.validFrom <= targetMonthStr);
  
  return active ? active.monthlyHours : baseRequiredHours;
}
