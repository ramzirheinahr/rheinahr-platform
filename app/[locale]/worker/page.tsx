import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const dynamic = "force-dynamic";

async function getWorker() {
  const user = await getCurrentUser();
  if (!user) return null;
  return prisma.worker
    .findUnique({ where: { userId: user.id }, select: { id: true } })
    .catch(() => null);
}

async function getAssignments(workerId: string, year: number, month: number) {
  try {
    return await prisma.assignment.findMany({
      where: {
        workerId,
        order: {
          shiftDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      },
      orderBy: { order: { shiftDate: "asc" } },
      include: {
        order: {
          select: {
            shiftDate: true,
            startTime: true,
            endTime: true,
            notes: true,
            client: { select: { facilityName: true, address: true } },
          },
        },
      },
    });
  } catch {
    return [];
  }
}

async function getAvailability(workerId: string, year: number, month: number) {
  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));
  try {
    const blocks = await prisma.workerAvailability.findMany({
      where: {
        workerId,
        status: "unavailable",
        date: { gte: rangeStart, lt: rangeEnd },
      },
      select: { date: true, startTime: true, endTime: true },
    });
    return {
      initialBlocks: blocks.map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        startTime: b.startTime,
        endTime: b.endTime,
      })),
    };
  } catch {
    return { initialBlocks: [] };
  }
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
  const assignments = worker ? await getAssignments(worker.id, year, month) : [];
  const { initialBlocks } = worker
    ? await getAvailability(worker.id, year, month)
    : { initialBlocks: [] };

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
            date: a.order.shiftDate.toISOString().slice(0, 10),
            startTime: a.order.startTime,
            endTime: a.order.endTime,
            notes: a.order.notes,
            facilityName: a.order.client.facilityName,
            address: a.order.client.address,
          }))}
        />
      </section>
    </div>
  );
}
