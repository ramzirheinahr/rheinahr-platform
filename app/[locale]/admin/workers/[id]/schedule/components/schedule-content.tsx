import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  getWorkerMonthSchedule,
  getWorkerMonthAvailability,
} from "@/lib/worker-schedule";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";
import { WorkerAdjustments } from "@/components/admin/worker-adjustments";

export async function ScheduleContent({
  workerId,
  year,
  month,
  mealAllowanceType,
  travelAllowanceEnabled,
}: {
  workerId: string;
  year: number;
  month: number;
  mealAllowanceType?: string | null;
  travelAllowanceEnabled?: boolean | null;
}) {
  const av = await getTranslations("availability");

  const [{ rows: assignments, leaveDays, totals }, initialBlocks, adjustmentsData] = await Promise.all([
    getWorkerMonthSchedule(workerId, year, month),
    getWorkerMonthAvailability(workerId, year, month),
    prisma.workerHoursAdjustment.findMany({
      where: { workerId, month: `${year}-${String(month).padStart(2, "0")}` },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const adjustments = adjustmentsData.map((a) => ({
    id: a.id,
    month: a.month,
    type: a.type,
    hours: a.hours,
    notes: a.notes,
  }));

  return (
    <div className="space-y-6 mt-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{av("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{av("subtitle")}</p>
        </div>
        <AvailabilityBuilder
          year={year}
          month={month}
          workerId={workerId}
          isAdmin={true}
          initialBlocks={initialBlocks}
          assignments={assignments.map((a) => ({
            id: a.id,
            status: a.status,
            date: a.date,
            startTime: a.startTime,
            endTime: a.endTime,
            breakMinutes: a.breakMinutes,
            notes: a.notes,
            facilityName: a.facilityName,
            address: a.address,
            scheduledHours: a.scheduledHours,
            confirmedHours: a.confirmedHours,
            cancelRequested: a.cancelRequested,
            cancelNote: a.cancelNote,
            distanceKm: a.distanceKm,
            travelCost: a.travelCost,
            mealAllowance: a.mealAllowance,
            addMealAllowance: a.addMealAllowance,
            excludeMealAllowance: a.excludeMealAllowance,
            excludeTravelAllowance: a.excludeTravelAllowance,
            bonusHours: a.bonusHours,
          }))}
          requiredHours={totals.requiredHours}
          carryoverHours={totals.carryoverHours}
          leaveDays={leaveDays}
          mealAllowanceType={mealAllowanceType ?? undefined}
          travelAllowanceEnabled={travelAllowanceEnabled ?? undefined}
        />
      </section>

      <section>
        <WorkerAdjustments workerId={workerId} adjustments={adjustments} />
      </section>
    </div>
  );
}
