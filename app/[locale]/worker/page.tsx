import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";
import {
  getWorkerMonthSchedule,
  getWorkerMonthUnavailability,
} from "@/lib/worker-schedule";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

async function getWorker() {
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.worker
    .findUnique({ where: { userId: user.id }, select: { id: true } })
    .catch(() => null);
}

export default async function WorkerSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const p = await getTranslations("portal");
  const av = await getTranslations("availability");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const worker = await getWorker();
  const { rows: assignments } = worker
    ? await getWorkerMonthSchedule(worker.id, year, month)
    : { rows: [] };
  const initialBlocks = worker
    ? await getWorkerMonthUnavailability(worker.id, year, month)
    : [];

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{p("schedule")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{p("scheduleSubtitle")}</p>
      </div>

      {/* Shared month navigator — drives both the assignments table and the availability editor. */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`/worker?year=${prev.y}&month=${prev.m}`} />}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {av("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`/worker?year=${next.y}&month=${next.m}`} />}
        >
          {av("nextMonth")}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      {/* Unified Availability & Tasks Table */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{av("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{av("subtitle")}</p>
        </div>
        <AvailabilityBuilder
          year={year}
          month={month}
          initialBlocks={initialBlocks}
          assignments={assignments.map((a) => ({
            id: a.id,
            status: a.status,
            date: a.date,
            startTime: a.startTime,
            endTime: a.endTime,
            notes: a.notes,
            facilityName: a.facilityName,
            address: a.address,
            confirmedHours: a.confirmedHours,
          }))}
        />
      </section>
    </div>
  );
}
