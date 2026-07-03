import { getTranslations } from "next-intl/server";
import type { ClientScheduleRow, ClientScheduleTotals } from "@/lib/client-schedule";
import { germanHolidays } from "@/lib/holidays";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock } from "lucide-react";

// One facility's month as the familiar schedule table — every day of the
// month (weekend/NRW-holiday tint), each deployment with worker, times,
// confirmation badge and net hours, plus the month-total footer. Server
// component shared by the client portal page and the admin per-facility page.
export async function MonthScheduleTable({
  rows,
  totals,
  locale,
  year,
  month,
}: {
  rows: ClientScheduleRow[];
  totals: ClientScheduleTotals;
  locale: string;
  year: number;
  month: number;
}) {
  const t = await getTranslations("clientSchedule");
  const av = await getTranslations("availability");
  const oq = await getTranslations("orderRequest");
  const ot = await getTranslations("orders");
  const eq = await getTranslations("enums.qualification");
  const eas = await getTranslations("enums.assignmentStatus");

  const dayFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  const hoursFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

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

  return (
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
  );
}
