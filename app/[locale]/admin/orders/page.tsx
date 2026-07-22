import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  requestNetTotal,
  resolveSurcharges,
  resolveRates,
  resolveNightWindow,
} from "@/lib/pricing";
import { formatDateDE } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { OrdersList, type OrderGroupSummary } from "@/components/admin/orders-list";
import { orderStatuses } from "@/lib/validations";
import { Plus, ChevronRight, ChevronLeft } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import type { Qualification } from "@/lib/validations";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  requestGroupId: string | null;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  quantity: number;
  requiredQualification: Qualification;
  status: OrderStatus;
  assignments: {
    contractId: string | null;
    invoiceId: string | null;
  }[];
  client: {
    facilityName: string;
    surchargeSat: number | null;
    surchargeSun: number | null;
    surchargeHoliday: number | null;
    surchargeNight: number | null;
    nightStart: string | null;
    nightEnd: string | null;
    hourlyRates: unknown;
  };
};

async function getOrders(year: number, month: number): Promise<Row[]> {
  try {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    return await prisma.order.findMany({
      where: {
        shiftDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      orderBy: [{ createdAt: "desc" }, { shiftDate: "asc" }],
      select: {
        id: true,
        requestGroupId: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        breakMinutes: true,
        quantity: true,
        requiredQualification: true,
        status: true,
        assignments: {
          select: {
            contractId: true,
            invoiceId: true,
          },
        },
        client: {
          select: {
            facilityName: true,
            surchargeSat: true,
            surchargeSun: true,
            surchargeHoliday: true,
            surchargeNight: true,
            nightStart: true,
            nightEnd: true,
            hourlyRates: true,
          },
        },
      },
    });
  } catch {
    return [];
  }
}

function groupOrders(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.requestGroupId ?? r.id;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return Array.from(map.entries()).map(([key, shifts]) => ({
    key,
    shifts: [...shifts].sort(
      (a, b) => a.shiftDate.getTime() - b.shiftDate.getTime(),
    ),
  }));
}

export default async function AdminOrdersPage(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const searchParams = await props.searchParams;
  const monthParam = typeof searchParams?.month === "string" ? searchParams.month : null;
  
  let targetYear = new Date().getUTCFullYear();
  let targetMonth = new Date().getUTCMonth() + 1;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    targetYear = parseInt(monthParam.slice(0, 4), 10);
    targetMonth = parseInt(monthParam.slice(5, 7), 10);
  }

  const prevMonthStr = `${targetMonth === 1 ? targetYear - 1 : targetYear}-${String(targetMonth === 1 ? 12 : targetMonth - 1).padStart(2, "0")}`;
  const nextMonthStr = `${targetMonth === 12 ? targetYear + 1 : targetYear}-${String(targetMonth === 12 ? 1 : targetMonth + 1).padStart(2, "0")}`;

  const t = await getTranslations("orders");
  const locale = await getLocale();
  const rows = await getOrders(targetYear, targetMonth);
  const groups = groupOrders(rows);
  const fmtEur = (n: number) =>
    n.toLocaleString(locale, { style: "currency", currency: "EUR" });

  const monthName = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(targetYear, targetMonth - 1, 1)));

  const summaries: OrderGroupSummary[] = groups.map((g) => {
    const first = g.shifts[0];
    const last = g.shifts[g.shifts.length - 1];
    const range =
      formatDateDE(first.shiftDate) === formatDateDE(last.shiftDate)
        ? formatDateDE(first.shiftDate)
        : `${formatDateDE(first.shiftDate)} – ${formatDateDE(last.shiftDate)}`;
    const total = requestNetTotal(
      g.shifts,
      resolveSurcharges(first.client),
      resolveRates(first.client),
      resolveNightWindow(first.client),
    );

    const isFullyCompleted = g.shifts.length > 0 && g.shifts.every(s => 
      s.status === "confirmed" && 
      s.assignments.length > 0 && 
      s.assignments.every(a => a.contractId !== null && a.invoiceId !== null)
    );

    return {
      key: g.key,
      facilityName: first.client.facilityName,
      range,
      shiftsCount: g.shifts.length,
      netLabel: fmtEur(total),
      status: first.status,
      qualification: first.requiredQualification,
      cancelled: g.shifts.every((s) => s.status === "cancelled"),
      isFullyCompleted,
      timestamp: first.shiftDate.getTime(),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-2 border rounded-md p-1">
          <Link href={`?month=${prevMonthStr}`} className={buttonVariants({ variant: "ghost", size: "icon", className: "h-8 w-8" })}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Link>
          <span className="text-sm font-medium px-4 min-w-32 text-center">{monthName}</span>
          <Link href={`?month=${nextMonthStr}`} className={buttonVariants({ variant: "ghost", size: "icon", className: "h-8 w-8" })}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Link>
        </div>
        <Button className="gap-2" render={<Link href="/admin/orders/new" />}>
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      <OrdersList groups={summaries} statuses={[...orderStatuses] as OrderStatus[]} />
    </div>
  );
}
