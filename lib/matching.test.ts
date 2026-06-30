import { describe, it, expect } from "vitest";
import { eligibleWorkers, eligibleWorkerIds, type MatchCandidate } from "./matching";

const make = (over: Partial<MatchCandidate>): MatchCandidate => ({
  workerId: "w",
  qualification: "pflegefachkraft",
  unavailable: false,
  alreadyAssigned: false,
  ...over,
});

describe("eligibleWorkers", () => {
  it("includes a qualified, available, unassigned worker", () => {
    const c = [make({ workerId: "a" })];
    expect(eligibleWorkerIds("pflegefachkraft", c)).toEqual(["a"]);
  });

  it("excludes workers with a different qualification", () => {
    const c = [make({ workerId: "a", qualification: "altenpfleger" })];
    expect(eligibleWorkers("pflegefachkraft", c)).toHaveLength(0);
  });

  it("excludes workers marked unavailable on the date", () => {
    const c = [make({ workerId: "a", unavailable: true })];
    expect(eligibleWorkers("pflegefachkraft", c)).toHaveLength(0);
  });

  it("excludes workers already assigned that day", () => {
    const c = [make({ workerId: "a", alreadyAssigned: true })];
    expect(eligibleWorkers("pflegefachkraft", c)).toHaveLength(0);
  });

  it("filters a mixed pool and preserves order", () => {
    const c = [
      make({ workerId: "ok1" }),
      make({ workerId: "wrongQual", qualification: "betreuungskraft" }),
      make({ workerId: "busy", alreadyAssigned: true }),
      make({ workerId: "ok2" }),
      make({ workerId: "off", unavailable: true }),
    ];
    expect(eligibleWorkerIds("pflegefachkraft", c)).toEqual(["ok1", "ok2"]);
  });
});
