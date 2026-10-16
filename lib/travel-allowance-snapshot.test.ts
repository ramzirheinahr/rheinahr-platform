import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/geocoding", () => ({ getDrivingDistanceKm: mocks.route,
  estimateGermanDistanceKm: () => 25 }));
vi.mock("@/lib/prisma", () => ({ prisma: { assignment: {
  updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUniqueOrThrow,
} } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { getOrFreezeTravelLine } from "@/lib/travel-allowance-snapshot";

const shift = {
  id: "shift-1",
  excludeTravelAllowance: false,
  travelDistanceKm: null,
  travelRatePerKm: null,
  travelCostCents: null,
  travelEligible: null,
  travelSnapshotAt: null,
  travelOriginAddress: null,
  travelDestinationAddress: null,
  travelSnapshotSource: null,
  order: { shiftDate: new Date("2026-09-05T00:00:00Z"), clientId: "client-1",
    client: { address: "Destination", facilityName: "Facility" } },
};
const worker = { address: "Origin", travelAllowanceEnabled: true, travelAllowancePerKm: 0.3 };

describe("frozen travel allowance per confirmed shift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.route.mockResolvedValue(113.07);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("stores exact cents on first calculation", async () => {
    const line = await getOrFreezeTravelLine(shift, null, worker);
    expect(line).toEqual({ distanceKm: 113.07, ratePerKm: 0.3, costCents: 3392, eligible: true,
      originAddress: "Origin", destinationAddress: "Destination" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "shift-1", travelSnapshotAt: null },
      data: expect.objectContaining({ travelCostCents: 3392 }),
    }));
  });

  it("reuses historical cents after address, rate, or route changes", async () => {
    const saved = { ...shift, travelDistanceKm: 113.07, travelRatePerKm: 0.3,
      travelCostCents: 3392, travelEligible: true, travelSnapshotAt: new Date(),
      travelOriginAddress: "Origin", travelDestinationAddress: "Destination" };
    const line = await getOrFreezeTravelLine(saved, null,
      { address: "Changed origin", travelAllowanceEnabled: true, travelAllowancePerKm: 0.4 });
    expect(line.costCents).toBe(3392);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("reads the winner of a concurrent first calculation", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUniqueOrThrow.mockResolvedValue({ travelDistanceKm: 113.07,
      travelRatePerKm: 0.3, travelCostCents: 3392, travelEligible: true, travelSnapshotAt: new Date(),
      travelOriginAddress: "Origin", travelDestinationAddress: "Destination" });
    expect((await getOrFreezeTravelLine(shift, null, worker)).costCents).toBe(3392);
  });

  it("does not freeze an estimated amount when the live route is unavailable", async () => {
    mocks.route.mockResolvedValue(null);
    const line = await getOrFreezeTravelLine(shift, null, worker);
    expect(line.costCents).toBe(750);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("does not request a route for a shift without travel reimbursement", async () => {
    const line = await getOrFreezeTravelLine({ ...shift, excludeTravelAllowance: true }, null, worker);
    expect(line.costCents).toBe(0);
    expect(line.distanceKm).toBe(0);
    expect(mocks.route).not.toHaveBeenCalled();
  });
});
