import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getClientMonthSchedule } from "@/lib/client-schedule";
import { MonthScheduleTable } from "@/components/client/month-schedule-table";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Download,
  FileDown,
  Sheet,
} from "lucide-react";
import { ScheduleMonthPicker } from "@/app/[locale]/admin/components/schedule-month-picker";

export const dynamic = "force-dynamic";

// Admin mirror of the client's month overview — everything RheinAhr worked at
// one facility, identical table + the same PDF / Excel download.
export default async function AdminClientSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale, id } = await params;
  const sp = await searchParams;
  const t = await getTranslations("clients");
  const cs = await getTranslations("clientSchedule");
  const av = await getTranslations("availability");
  const c = await getTranslations("common");

  const client = await prisma.client
    .findUnique({ where: { id }, select: { id: true, facilityName: true } })
    .catch(() => null);
  if (!client) notFound();

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const { rows, totals } = await getClientMonthSchedule(client.id, year, month);

  const base = `/admin/clients/${client.id}/schedule`;
  const exportBase = `/api/exports/client-schedule?year=${year}&month=${month}&clientId=${client.id}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href="/admin/clients" />}
          >
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {c("back")}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{client.facilityName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("scheduleHint")}</p>
          </div>
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
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<a href={`${exportBase}&format=csv`} />}
          >
            <Sheet className="size-4" />
            {cs("downloadExcel")}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-2 py-1.5">
        <ScheduleMonthPicker currentYear={year} currentMonth={month} baseRoute={base} />
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

      <MonthScheduleTable
        rows={rows}
        totals={totals}
        locale={locale}
        year={year}
        month={month}
        showPrices={true}
      />
    </div>
  );
}
