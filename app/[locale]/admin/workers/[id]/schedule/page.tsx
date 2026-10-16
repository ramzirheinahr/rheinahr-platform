import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, FileText } from "lucide-react";
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
  const { id } = await params;
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
    <div className="space-y-8 overflow-x-hidden">
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

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-2 py-1.5">
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
        <div className="flex items-center gap-3 pr-2">
          <a
            href={`/api/workers/${worker.id}/dienstplan?year=${year}&month=${month}`}
            className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline flex items-center gap-1.5 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded px-2.5 py-1 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <FileText className="size-3.5" />
            {t("downloadDienstplan")}
          </a>
          <a
            href={`${base}/export?year=${year}&month=${month}`}
            className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="size-3.5" />
            {t("exportPayroll")}
          </a>
        </div>
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
