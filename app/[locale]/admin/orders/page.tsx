import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requestNetTotal, resolveSurcharges, resolveRates } from "@/lib/pricing";
import { formatDateDE } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrdersList, type OrderGroupSummary } from "@/components/admin/orders-list";
import { orderStatuses } from "@/lib/validations";
import { Plus } from "lucide-react";
import type { OrderStatus, Qualification } from "@prisma/client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  requestGroupId: string | null;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  quantity: number;
  requiredQualification: Qualification;
  status: OrderStatus;
  client: {
    facilityName: string;
    surchargeSat: number | null;
    surchargeSun: number | null;
    surchargeHoliday: number | null;
    hourlyRates: unknown;
  };
};

async function getOrders(): Promise<Row[]> {
  try {
    return await prisma.order.findMany({
      orderBy: [{ createdAt: "desc" }, { shiftDate: "asc" }],
      select: {
        id: true,
        requestGroupId: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        quantity: true,
        requiredQualification: true,
        status: true,
        client: {
          select: {
            facilityName: true,
            surchargeSat: true,
            surchargeSun: true,
            surchargeHoliday: true,
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

export default async function AdminOrdersPage() {
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const rows = await getOrders();
  const groups = groupOrders(rows);
  const fmtEur = (n: number) =>
    n.toLocaleString(locale, { style: "currency", currency: "EUR" });

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
    );
    return {
      key: g.key,
      facilityName: first.client.facilityName,
      range,
      shiftsCount: g.shifts.length,
      netLabel: fmtEur(total),
      status: first.status,
      cancelled: g.shifts.every((s) => s.status === "cancelled"),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button className="gap-2" render={<Link href="/admin/orders/new" />}>
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      <OrdersList groups={summaries} statuses={[...orderStatuses] as OrderStatus[]} />
    </div>
  );
}
