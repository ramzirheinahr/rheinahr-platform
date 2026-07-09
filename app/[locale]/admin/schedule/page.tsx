import { getTranslations } from "next-intl/server";
import { getMasterSchedule } from "@/lib/master-schedule";
import { qualifications } from "@/lib/validations";
import { MasterScheduleGrid } from "@/components/admin/master-schedule-grid";
import { LiveRefresher } from "@/components/portal/live-refresher";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Qualification } from "@prisma/client";

export const dynamic = "force-dynamic";

// The master Dienstplan: the company's Excel shift sheet as a live, editable
// grid — one tab per qualification, workers alphabetical, facility legend at
// the side. Cell edits write to the real availability/order records.
export default async function AdminMasterSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string; qualification?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("masterSchedule");
  const av = await getTranslations("availability");
  const oq = await getTranslations("orderRequest");
  const cs = await getTranslations("clientSchedule");
  const eq = await getTranslations("enums.qualification");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();
  const qualification: Qualification = (qualifications as readonly string[]).includes(
    sp.qualification ?? "",
  )
    ? (sp.qualification as Qualification)
    : "pflegefachkraft";

  const { rows, facilities, unassigned } = await getMasterSchedule(
    qualification,
    year,
    month,
  );

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const qs = (y: number, m: number, q: string) =>
    `/admin/schedule?year=${y}&month=${m}&qualification=${q}`;
  const exportBase = `/api/exports/master-schedule?year=${year}&month=${month}&qualification=${qualification}`;

  return (
    <div className="space-y-6">
      {/* Live: grid reflects other users' shift/availability/leave changes instantly. */}
      <LiveRefresher tables={["orders", "assignments", "worker_availability", "leave_days"]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<a href={`${exportBase}&format=pdf`} />}
          >
            <FileDown className="size-4" />
            {cs("downloadPdf")}
          </Button>
        </div>
      </div>

      {/* One sheet per qualification — like the separate Excel tabs. */}
      <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
        {qualifications.map((q) => (
          <Link
            key={q}
            href={qs(year, month, q)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              q === qualification
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {eq(q)}
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={qs(prev.y, prev.m, qualification)} />}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" />
          {av("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1"
          render={<Link href={qs(next.y, next.m, qualification)} />}
        >
          {av("nextMonth")}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      {/* Full width — the facility legend now lives behind a floating button
          inside the grid (bottom corner) to keep the sheet as wide as possible. */}
      <div>
        <MasterScheduleGrid
          year={year}
          month={month}
          qualification={qualification}
          rows={rows}
          facilities={facilities}
          unassigned={unassigned}
          now={now.getTime()}
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            F = {oq("preset_early")} · S = {oq("preset_late")} · N = {oq("preset_night")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-red-600/50" /> {t("statePending")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-red-800" /> {t("stateAccepted")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-emerald-400" /> {t("stateDone")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-emerald-600" /> {t("stateSigned")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded border bg-emerald-400/25" /> {oq("holidayLegend")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded border bg-rose-500/15" /> {oq("weekendLegend")}
          </span>
        </div>
      </div>
    </div>
  );
}
