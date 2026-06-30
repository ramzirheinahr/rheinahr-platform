import type { Qualification } from "@prisma/client";

// Availability-matching engine (CLAUDE.md §5 "Availability Engine").
// Pure & dependency-free so it can be unit-tested in isolation. The DB layer
// assembles `MatchCandidate[]` for a given shift date and calls this.

export type MatchCandidate = {
  workerId: string;
  qualification: Qualification;
  /** Worker explicitly marked unavailable on the shift date. */
  unavailable: boolean;
  /** Worker already holds a non-declined assignment on the shift date. */
  alreadyAssigned: boolean;
};

/**
 * Returns the candidates eligible for a shift: the qualification must match and
 * the worker must be neither explicitly unavailable nor already booked that day.
 * Order is preserved (callers may pre-sort by preference).
 */
export function eligibleWorkers<T extends MatchCandidate>(
  requiredQualification: Qualification,
  candidates: T[],
): T[] {
  return candidates.filter(
    (c) =>
      c.qualification === requiredQualification &&
      !c.unavailable &&
      !c.alreadyAssigned,
  );
}

/** Convenience: just the eligible worker ids. */
export function eligibleWorkerIds(
  requiredQualification: Qualification,
  candidates: MatchCandidate[],
): string[] {
  return eligibleWorkers(requiredQualification, candidates).map((c) => c.workerId);
}
