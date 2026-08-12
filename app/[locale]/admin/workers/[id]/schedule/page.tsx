import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getWorkerMonthSchedule,
  getWorkerMonthAvailability,
} from "@/lib/worker-schedule";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";
import { WorkerAdjustments } from "@/components/admin/worker-adjustments";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { ScheduleMonthPicker } from "@/app/[locale]/admin/components/schedule-month-picker";
import { WorkerSearchDropdown } from "@/app/[locale]/admin/components/worker-search-dropdown";

export const dynamic = "force-dynamic";

// Admin mirror of the worker's own schedule page — the identical editable
// table (accept/decline assignments, edit availability, confirmed hours +
// month total), so the office can act on changes a worker phones in.
export default async function AdminWorkerSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const t = await getTranslations("workers");
  const av = await getTranslations("availability");
  const c = await getTranslations("common");

  const worker = await prisma.worker
    .findUnique({ 
      where: { id }, 
      select: { id: true, fullName: true, carryoverHours: true, mealAllowanceType: true, travelAllowanceEnabled: true } 
    })
    .catch(() => null);
  if (!worker) notFound();

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const [{ rows: assignments, leaveDays, totals }, initialBlocks, adjustmentsData, allWorkers] = await Promise.all([
    getWorkerMonthSchedule(worker.id, year, month),
    getWorkerMonthAvailability(worker.id, year, month),
    prisma.workerHoursAdjustment.findMany({
      where: { workerId: worker.id, month: `${year}-${String(month).padStart(2, "0")}` },
      orderBy: { createdAt: "desc" },
    }),
    prisma.worker.findMany({
      select: {
        id: true,
        fullName: true,
        internalNumber: true,
        phone: true,
        user: { select: { email: true } },
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const adjustments = adjustmentsData.map(a => ({
    id: a.id,
    month: a.month,
    type: a.type,
    hours: a.hours,
    notes: a.notes,
  }));

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const base = `/admin/workers/${worker.id}/schedule`;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/admin/workers" />}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {c("back")}
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{worker.fullName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("scheduleHint")}</p>
        </div>
      </div>

      {/* Same month navigator as the worker page — drives table + availability. */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <div className="flex items-center gap-4">
          <ScheduleMonthPicker currentYear={year} currentMonth={month} baseRoute={base} />
          <WorkerSearchDropdown 
            currentWorkerId={worker.id}
            workers={allWorkers.map((w) => ({
              id: w.id,
              fullName: w.fullName,
              internalNumber: w.internalNumber,
              phone: w.phone,
              email: w.user.email,
            }))}
          />
        </div>
        <a
          href={`${base}/export?year=${year}&month=${month}`}
          className="text-xs font-medium text-primary hover:underline flex items-center gap-1 pr-4"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download className="size-3" />
          Abrechnung exportieren
        </a>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{av("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{av("subtitle")}</p>
        </div>
        <AvailabilityBuilder
          year={year}
          month={month}
          workerId={worker.id}
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
          mealAllowanceType={worker.mealAllowanceType}
          travelAllowanceEnabled={worker.travelAllowanceEnabled}
        />
      </section>

      <section>
        <WorkerAdjustments workerId={worker.id} adjustments={adjustments} />
      </section>
    </div>
  );
}
