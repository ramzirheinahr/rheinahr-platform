import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { germanHolidays } from "@/lib/holidays";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignmentActions } from "@/components/worker/assignment-actions";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";

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
    const [blocks, asg] = await Promise.all([
      prisma.workerAvailability.findMany({
        where: {
          workerId,
          status: "unavailable",
          date: { gte: rangeStart, lt: rangeEnd },
        },
        select: { date: true, startTime: true, endTime: true },
      }),
      prisma.assignment.findMany({
        where: {
          workerId,
          status: { not: "declined" },
          order: { shiftDate: { gte: rangeStart, lt: rangeEnd } },
        },
        select: { order: { select: { shiftDate: true } } },
      }),
    ]);
    return {
      initialBlocks: blocks.map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        startTime: b.startTime,
        endTime: b.endTime,
      })),
      assignedDates: asg.map((a) => a.order.shiftDate.toISOString().slice(0, 10)),
    };
  } catch {
    return { initialBlocks: [], assignedDates: [] };
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
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const oq = await getTranslations("orderRequest");
  const eas = await getTranslations("enums.assignmentStatus");
  const av = await getTranslations("availability");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const worker = await getWorker();
  const assignments = worker ? await getAssignments(worker.id, year, month) : [];
  const { initialBlocks, assignedDates } = worker
    ? await getAvailability(worker.id, year, month)
    : { initialBlocks: [], assignedDates: [] };

  const holidays = germanHolidays(year);
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

      {/* Assignments — accept / confirm shifts */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("myAssignments")}</h2>
        {assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {t("noAssignments")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shiftDate")}</TableHead>
                  <TableHead>{t("facility")}</TableHead>
                  <TableHead>{t("shiftTime")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-end">{c("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((a) => {
                  const dateStr = a.order.shiftDate.toISOString().slice(0, 10);
                  const dow = a.order.shiftDate.getUTCDay();
                  const weekendOrHoliday =
                    dow === 0 || dow === 6 || holidays.has(dateStr);
                  return (
                    <TableRow
                      key={a.id}
                      className={cn(weekendOrHoliday && "bg-rose-500/10")}
                    >
                      <TableCell className="whitespace-nowrap font-medium align-top">
                        {dateStr}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="font-medium">
                          {a.order.client.facilityName}
                        </div>
                        {a.order.client.address ? (
                          <div className="text-xs text-muted-foreground">
                            {a.order.client.address}
                          </div>
                        ) : null}
                        {a.order.notes ? (
                          <div className="text-xs text-muted-foreground">
                            {oq("ward")}: {a.order.notes}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap align-top">
                        {a.order.startTime}–{a.order.endTime}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant={
                            a.status === "confirmed"
                              ? "default"
                              : a.status === "declined"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {eas(a.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex items-center justify-end gap-2">
                          {a.status === "pending" ? (
                            <AssignmentActions assignmentId={a.id} />
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            render={<Link href={`/worker/assignments/${a.id}`} />}
                          >
                            <MessageSquare className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Availability — set unavailable days/shifts for the month */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{av("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{av("subtitle")}</p>
        </div>
        <AvailabilityBuilder
          year={year}
          month={month}
          initialBlocks={initialBlocks}
          assignedDates={assignedDates}
        />
      </section>
    </div>
  );
}
