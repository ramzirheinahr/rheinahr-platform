import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getClientMonthSchedule } from "@/lib/client-schedule";
import { MonthScheduleTable } from "@/components/client/month-schedule-table";
import { ClientContractsBanner } from "@/components/client/client-contracts-banner";
import { ClientInvoicesBanner } from "@/components/client/client-invoices-banner";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileDown, Sheet } from "lucide-react";
import { LiveRefresher } from "@/components/portal/live-refresher";

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
    : {
        rows: [],
        totals: {
          confirmedHours: 0,
          confirmedShifts: 0,
          acceptedHours: 0,
          acceptedShifts: 0,
          totalHours: 0,
        },
      };

  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  
  const contracts = client ? await prisma.clientContract.findMany({
    where: {
      clientId: client.id,
      assignments: {
        some: {
          order: {
            shiftDate: { gte: startDate, lt: endDate }
          }
        }
      }
    },
    include: {
      client: true,
      assignments: {
        include: { order: true, worker: true }
      }
    }
  }) : [];

  const invoices = client ? await prisma.invoice.findMany({
    where: {
      clientId: client.id,
      date: { gte: startDate, lt: endDate }
    }
  }) : [];

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const exportBase = `/api/exports/client-schedule?year=${year}&month=${month}`;

  return (
    <div className="space-y-8">
      <LiveRefresher tables={["orders", "assignments", "service_confirmations"]} />
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

      <ClientContractsBanner contracts={contracts} />
      <ClientInvoicesBanner invoices={invoices} />

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

      <MonthScheduleTable
        rows={rows}
        totals={totals}
        locale={locale}
        year={year}
        month={month}
      />
    </div>
  );
}
