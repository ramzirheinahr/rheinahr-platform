import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getWorkerMonthSchedule } from "@/lib/worker-schedule";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle2, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

// Admin view of one worker's month: the same shifts, client-confirmed hours
// and net total (break deducted) the worker sees in their own schedule.
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
  const oq = await getTranslations("orderRequest");
  const c = await getTranslations("common");
  const ot = await getTranslations("orders");
  const eas = await getTranslations("enums.assignmentStatus");

  const worker = await prisma.worker
    .findUnique({ where: { id }, select: { id: true, fullName: true } })
    .catch(() => null);
  if (!worker) notFound();

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const { rows, totals } = await getWorkerMonthSchedule(worker.id, year, month);

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const dateFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
  const hoursFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const base = `/admin/workers/${worker.id}/schedule`;

  return (
    <div className="space-y-6">
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
        <div>
          <h1 className="text-2xl font-semibold">{worker.fullName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("scheduleHint")}</p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`${base}?year=${prev.y}&month=${prev.m}`} />}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {av("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={`${base}?year=${next.y}&month=${next.m}`} />}
        >
          {av("nextMonth")}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("scheduleEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                <th className="p-2 text-start">Datum</th>
                <th className="p-2 text-start">{av("shiftOrTask")}</th>
                <th className="p-2 text-start">{ot("status")}</th>
                <th className="p-2 text-start">{oq("von")}</th>
                <th className="p-2 text-start">{oq("bis")}</th>
                <th className="p-2 text-end">{av("hoursHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b bg-primary/5">
                  <td className="whitespace-nowrap p-2 font-medium">
                    {dateFmt.format(new Date(`${a.date}T00:00:00Z`))}
                  </td>
                  <td className="p-2">
                    <div className="font-medium text-primary">{a.facilityName}</div>
                    {a.address ? (
                      <div className="text-xs text-muted-foreground">{a.address}</div>
                    ) : null}
                    {a.notes ? (
                      <div className="text-xs text-muted-foreground">
                        {oq("ward")}: {a.notes}
                      </div>
                    ) : null}
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
              ))}
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
      )}
    </div>
  );
}
