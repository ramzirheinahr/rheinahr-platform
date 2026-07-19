import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, resolveClientId } from "@/lib/auth";
import {
  requestNetTotal,
  resolveSurcharges,
  resolveRates,
  resolveNightWindow,
  type Surcharges,
  type Rates,
  type NightWindow,
} from "@/lib/pricing";
import { formatDateDE, cn } from "@/lib/utils";
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
  breakMinutes: number;
  quantity: number;
  requiredQualification: Qualification;
  status: OrderStatus;
};

async function getOrders(): Promise<{
  rows: Row[];
  surcharges: Surcharges;
  rates: Rates;
  night: NightWindow;
  facilityName: string | null;
}> {
  const empty = {
    rows: [],
    surcharges: resolveSurcharges(null),
    rates: resolveRates(null),
    night: resolveNightWindow(null),
    facilityName: null,
  };
  const user = await getCurrentUser();
  if (!user) return empty;
  try {
    const clientId = await resolveClientId(user);
    if (!clientId) return empty;
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
        hourlyRates: true,
        facilityName: true,
      },
    });
    if (!client) return empty;
    const rows = await prisma.order.findMany({
      where: { clientId: client.id },
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
      },
    });
    return {
      rows,
      surcharges: resolveSurcharges(client),
      rates: resolveRates(client),
      night: resolveNightWindow(client),
      facilityName: client.facilityName,
    };
  } catch {
    return empty;
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

export default async function ClientOrdersPage() {
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const { rows, surcharges, rates, night, facilityName } = await getOrders();
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
    const total = requestNetTotal(g.shifts, surcharges, rates, night);
    return {
      key: g.key,
      facilityName: facilityName ?? "Client",
      range,
      shiftsCount: g.shifts.length,
      netLabel: fmtEur(total),
      status: first.status,
      qualification: first.requiredQualification,
      cancelled: g.shifts.every((s) => s.status === "cancelled"),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/client/orders/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      <OrdersList groups={summaries} statuses={[...orderStatuses] as OrderStatus[]} basePath="/client/orders" />
    </div>
  );
}
