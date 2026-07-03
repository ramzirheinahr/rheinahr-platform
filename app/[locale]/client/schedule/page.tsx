import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getClientMonthSchedule, type ClientScheduleRow } from "@/lib/client-schedule";
import { germanHolidays } from "@/lib/holidays";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  FileDown,
  Sheet,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Client mirror of the worker schedule: every deployment at this facility in
// one month — same monthly table (all days, weekend/holiday tint, confirmed
// hours + net total) plus PDF / Excel download of exactly this view.
export default async function ClientSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("clientSchedule");
  const av = await getTranslations("availability");
  const oq = await getTranslations("orderRequest");
  const ot = await getTranslations("orders");
  const eq = await getTranslations("enums.qualification");
  const eas = await getTranslations("enums.assignmentStatus");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const user = await getCurrentUser();
  const client = user
    ? await prisma.client
        .findUnique({ where: { userId: user.id }, select: { id: true } })
        .catch(() => null)
    : null;
  const { rows, totals } = client
    ? await getClientMonthSchedule(client.id, year, month)
    : { rows: [], totals: { confirmedHours: 0, confirmedShifts: 0 } };

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const dayFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  const hoursFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  // Same day grid as the worker table: every day of the month, tinted on
  // weekends/holidays, shift rows highlighted.
  const holidays = germanHolidays(year);
  const byDate = new Map<string, ClientScheduleRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const date = `${year}-${pad(month)}-${pad(i + 1)}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      label: dayFmt.format(new Date(Date.UTC(year, month - 1, i + 1))),
      weekend: dow === 0 || dow === 6,
      holiday: holidays.get(date),
      shifts: byDate.get(date) ?? [],
    };
  });

  const exportBase = `/api/exports/client-schedule?year=${year}&month=${month}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<a href={`${exportBase}&format=pdf`} />}
          >
            <FileDown className="size-4" />
            {t("downloadPdf")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<a href={`${exportBase}&format=csv`} />}
          >
            <Sheet className="size-4" />
            {t("downloadExcel")}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`/client/schedule?year=${prev.y}&month=${prev.m}`} />}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {av("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`/client/schedule?year=${next.y}&month=${next.m}`} />}
        >
          {av("nextMonth")}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
              <th className="p-2 text-start">Datum</th>
              <th className="p-2 text-start">{t("workerHeader")}</th>
              <th className="p-2 text-start">{ot("status")}</th>
              <th className="p-2 text-start">{oq("von")}</th>
              <th className="p-2 text-start">{oq("bis")}</th>
              <th className="p-2 text-end">{av("hoursHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const tint = (d.weekend || d.holiday) && "bg-rose-500/10";
              if (d.shifts.length === 0) {
                return (
                  <tr key={d.date} title={d.holiday ?? undefined} className={cn("border-b", tint)}>
                    <td className="whitespace-nowrap p-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{d.label}</span>
                        {d.holiday ? <span className="text-rose-600">•</span> : null}
                      </div>
                    </td>
                    <td className="p-2" colSpan={5}></td>
                  </tr>
                );
              }
              return d.shifts.map((a, i) => (
                <tr
                  key={a.id}
                  title={d.holiday ?? undefined}
                  className={cn("border-b bg-primary/5", tint)}
                >
                  <td className="whitespace-nowrap p-2 font-medium">
                    {i === 0 ? (
                      <div className="flex items-center gap-1.5">
                        <span>{d.label}</span>
                        {d.holiday ? <span className="text-rose-600">•</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2">
                    <div className="font-medium text-primary">{a.workerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {eq(a.qualification)}
                      {a.notes ? <> · {oq("ward")}: {a.notes}</> : null}
                    </div>
                  </td>
                  <td className="p-2">
                    {a.confirmedHours != null ? (
                      <Badge className="gap-1 border-transparent bg-emerald-600 text-white">
                        <CheckCircle2 className="size-3" />
                        {av("confirmedByClient")}
                      </Badge>
                    ) : (
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
                    )}
                  </td>
                  <td className="whitespace-nowrap p-2 font-medium text-primary">
                    {a.startTime}
                  </td>
                  <td className="whitespace-nowrap p-2 font-medium text-primary">
                    {a.endTime}
                  </td>
                  <td className="whitespace-nowrap p-2 text-end">
                    {a.confirmedHours != null ? (
                      <span className="font-semibold text-emerald-600">
                        {hoursFmt.format(a.confirmedHours)} {av("hoursUnit")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
          {totals.confirmedShifts > 0 ? (
            <tfoot>
              <tr className="border-t-2 bg-emerald-500/10">
                <td colSpan={5} className="p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <Clock className="size-4 text-emerald-600" />
                    {av("monthTotal")}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {av("monthTotalHint", { count: totals.confirmedShifts })}
                  </p>
                </td>
                <td className="whitespace-nowrap p-3 text-end align-middle text-lg font-bold text-emerald-600">
                  {hoursFmt.format(totals.confirmedHours)} {av("hoursUnit")}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
