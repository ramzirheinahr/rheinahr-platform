import "server-only";
import { prisma } from "@/lib/prisma";
import { estimateGermanDistanceKm, getDrivingDistanceKm } from "@/lib/geocoding";
import { audit } from "@/lib/audit";

type TravelAssignment = {
  id: string;
  excludeTravelAllowance: boolean;
  travelDistanceKm: number | null;
  travelRatePerKm: number | null;
  travelCostCents: number | null;
  travelEligible: boolean | null;
  travelSnapshotAt: Date | null;
  travelOriginAddress: string | null;
  travelDestinationAddress: string | null;
  travelSnapshotSource: string | null;
  order: {
    shiftDate: Date;
    clientId: string;
    client: { address: string | null; facilityName: string };
  };
};

type TravelWorker = {
  address: string | null;
  travelAllowanceEnabled: boolean;
  travelAllowancePerKm: number | null;
};

export type FrozenTravelLine = {
  distanceKm: number;
  ratePerKm: number;
  costCents: number;
  eligible: boolean;
  originAddress: string | null;
  destinationAddress: string;
};

function readFrozenLine(assignment: Pick<TravelAssignment,
  "travelDistanceKm" | "travelRatePerKm" | "travelCostCents" | "travelEligible" | "travelSnapshotAt" |
  "travelOriginAddress" | "travelDestinationAddress"
>): FrozenTravelLine | null {
  if (!assignment.travelSnapshotAt) return null;
  const { travelDistanceKm: distanceKm, travelRatePerKm: ratePerKm,
    travelCostCents: costCents, travelEligible: eligible,
    travelOriginAddress: originAddress, travelDestinationAddress: destinationAddress } = assignment;
  if (distanceKm == null || !Number.isFinite(distanceKm) || distanceKm < 0 ||
      ratePerKm == null || !Number.isFinite(ratePerKm) || ratePerKm < 0 ||
      costCents == null || !Number.isSafeInteger(costCents) || costCents < 0 ||
      eligible == null || !destinationAddress) {
    throw new Error("Incomplete frozen travel allowance calculation");
  }
  return { distanceKm, ratePerKm, costCents, eligible, originAddress, destinationAddress };
}

export async function getOrFreezeTravelLine(
  assignment: TravelAssignment,
  previousAssignment: TravelAssignment | null,
  worker: TravelWorker,
): Promise<FrozenTravelLine> {
  const existing = readFrozenLine(assignment);
  if (existing) return existing;

  const sameDayAndClient = previousAssignment?.order.clientId === assignment.order.clientId &&
    previousAssignment.order.shiftDate.toISOString().slice(0, 10) ===
      assignment.order.shiftDate.toISOString().slice(0, 10);
  const destination = assignment.order.client.address || assignment.order.client.facilityName;
  if (!destination?.trim()) throw new Error("Travel destination is missing");
  const eligible = worker.travelAllowanceEnabled && !assignment.excludeTravelAllowance;
  if (!eligible) {
    return { distanceKm: 0, ratePerKm: worker.travelAllowancePerKm ?? 0.3,
      costCents: 0, eligible: false, originAddress: worker.address,
      destinationAddress: destination };
  }
  let distanceKm = 0;
  let routeUnavailable = false;
  if (eligible && !sameDayAndClient) {
    if (worker.address && destination) {
      const routeKm = await getDrivingDistanceKm(worker.address, destination, { strict: true });
      if (routeKm == null) {
        // Keep the report available, but never permanently store a temporary route estimate.
        routeUnavailable = true;
        distanceKm = estimateGermanDistanceKm(worker.address, destination);
      } else {
        distanceKm = routeKm;
      }
    } else {
      distanceKm = 20;
    }
  }
  distanceKm = Math.round(distanceKm * 100) / 100;
  const ratePerKm = worker.travelAllowancePerKm ?? 0.3;
  if (!Number.isFinite(distanceKm) || distanceKm < 0 ||
      !Number.isFinite(ratePerKm) || ratePerKm < 0) {
    throw new Error("Invalid travel allowance inputs");
  }
  const costCents = eligible ? Math.round(distanceKm * ratePerKm * 100) : 0;
  if (routeUnavailable) {
    return { distanceKm, ratePerKm, costCents, eligible,
      originAddress: worker.address, destinationAddress: destination };
  }

  // Exactly one first calculation wins, including when PDF and Excel are requested together.
  const update = await prisma.assignment.updateMany({
    where: { id: assignment.id, travelSnapshotAt: null },
    data: { travelDistanceKm: distanceKm, travelRatePerKm: ratePerKm,
      travelCostCents: costCents, travelEligible: eligible, travelSnapshotAt: new Date(),
      travelOriginAddress: worker.address, travelDestinationAddress: destination,
      travelSnapshotSource: "calculated" },
  });
  if (update.count === 1) {
    await audit({ action: "travel-allowance.snapshot", entity: "Assignment", entityId: assignment.id,
      metadata: { distanceKm, ratePerKm, costCents, eligible } });
    return { distanceKm, ratePerKm, costCents, eligible,
      originAddress: worker.address, destinationAddress: destination };
  }

  const saved = await prisma.assignment.findUniqueOrThrow({
    where: { id: assignment.id },
    select: { travelDistanceKm: true, travelRatePerKm: true, travelCostCents: true,
      travelEligible: true, travelSnapshotAt: true,
      travelOriginAddress: true, travelDestinationAddress: true },
  });
  const winner = readFrozenLine(saved);
  if (!winner) throw new Error("Travel allowance calculation was not frozen");
  return winner;
}
