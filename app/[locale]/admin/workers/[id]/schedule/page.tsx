import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download } from "lucide-react";
import { ScheduleMonthPicker } from "@/app/[locale]/admin/components/schedule-month-picker";
import { WorkerSearchDropdown } from "@/app/[locale]/admin/components/worker-search-dropdown";
import { ScheduleSkeleton } from "@/components/admin/skeletons/schedule-skeleton";
import { ScheduleContent } from "./components/schedule-content";

export const dynamic = "force-dynamic";

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

  const allWorkers = await prisma.worker.findMany({
    select: {
      id: true,
      fullName: true,
      internalNumber: true,
      phone: true,
      user: { select: { email: true } },
    },
    orderBy: { fullName: "asc" },
  });

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

      <Suspense fallback={<ScheduleSkeleton />}>
        <ScheduleContent 
          workerId={worker.id} 
          year={year} 
          month={month} 
          mealAllowanceType={worker.mealAllowanceType}
          travelAllowanceEnabled={worker.travelAllowanceEnabled}
        />
      </Suspense>
    </div>
  );
}
