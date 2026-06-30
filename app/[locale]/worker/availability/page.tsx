import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import {
  AvailabilityCalendar,
  type DayCell,
} from "@/components/worker/availability-calendar";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");

function monthData(
  workerUnavailable: Set<string>,
  assignedDates: Set<string>,
  year: number,
  month: number,
) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first leading blanks
  const today = new Date().toISOString().slice(0, 10);

  const cells: DayCell[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push({ day: null, dateStr: null, status: "available", isToday: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    const status = assignedDates.has(dateStr)
      ? "assigned"
      : workerUnavailable.has(dateStr)
        ? "unavailable"
        : "available";
    cells.push({ day: d, dateStr, status, isToday: dateStr === today });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, dateStr: null, status: "available", isToday: false });
  }
  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default async function AvailabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("availability");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));

  const unavailable = new Set<string>();
  const assigned = new Set<string>();

  const user = await getCurrentUser();
  if (user) {
    const worker = await prisma.worker
      .findUnique({ where: { userId: user.id }, select: { id: true } })
      .catch(() => null);
    if (worker) {
      const [avail, asg] = await Promise.all([
        prisma.workerAvailability.findMany({
          where: {
            workerId: worker.id,
            status: "unavailable",
            date: { gte: rangeStart, lt: rangeEnd },
          },
          select: { date: true },
        }),
        prisma.assignment.findMany({
          where: {
            workerId: worker.id,
            status: { not: "declined" },
            order: { shiftDate: { gte: rangeStart, lt: rangeEnd } },
          },
          select: { order: { select: { shiftDate: true } } },
        }),
      ]);
      avail.forEach((a) => unavailable.add(a.date.toISOString().slice(0, 10)));
      asg.forEach((a) => assigned.add(a.order.shiftDate.toISOString().slice(0, 10)));
    }
  }

  const weeks = monthData(unavailable, assigned, year, month);

  const fmtMonth = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const fmtWeekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const monthLabel = fmtMonth.format(rangeStart);
  // 2024-01-01 was a Monday — build Mon..Sun headers.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    fmtWeekday.format(new Date(Date.UTC(2024, 0, 1 + i))),
  );

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AvailabilityCalendar
        weeks={weeks}
        weekdays={weekdays}
        monthLabel={monthLabel}
        prevHref={`/worker/availability?year=${prev.y}&month=${prev.m}`}
        nextHref={`/worker/availability?year=${next.y}&month=${next.m}`}
      />
    </div>
  );
}
