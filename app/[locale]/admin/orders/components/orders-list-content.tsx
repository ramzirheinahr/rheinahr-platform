import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  requestNetTotal,
  resolveSurcharges,
  resolveRates,
  resolveNightWindow,
} from "@/lib/pricing";
import { formatDateDE } from "@/lib/utils";
import { OrdersList, type OrderGroupSummary } from "@/components/admin/orders-list";
import { orderStatuses } from "@/lib/validations";
import type { OrderStatus } from "@prisma/client";
import type { Qualification } from "@/lib/validations";

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
  createdAt: Date;
  createdBy: { fullName: string | null; email: string; role: string } | null;
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
        OR: [
          {
            shiftDate: {
              gte: startDate,
              lt: endDate,
            },
          },
          { status: "pending" },
        ],
      },
      orderBy: [{ shiftDate: "asc" }],
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
        createdAt: true,
        createdBy: {
          select: { fullName: true, email: true, role: true },
        },
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

export async function OrdersListContent({
  targetYear,
  targetMonth,
}: {
  targetYear: number;
  targetMonth: number;
}) {
  const locale = await getLocale();
  const rows = await getOrders(targetYear, targetMonth);
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
      resolveNightWindow(first.client),
    );

    const isFullyCompleted = g.shifts.length > 0 && g.shifts.every(s => 
      s.status === "confirmed" && 
      s.assignments.length > 0 && 
      s.assignments.every(a => a.contractId !== null && a.invoiceId !== null)
    );

    const hasConfirmed = g.shifts.some(s => s.status === "confirmed");
    const hasUnconfirmed = g.shifts.some(s => s.status !== "confirmed" && s.status !== "cancelled");
    const isPartiallyConfirmed = hasConfirmed && hasUnconfirmed;

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
      isPartiallyConfirmed,
      timestamp: first.shiftDate.getTime(),
      createdAt: first.createdAt.getTime(),
      creatorName: first.createdBy
        ? first.createdBy.fullName || first.createdBy.email
        : undefined,
    };
  });

  return <OrdersList groups={summaries} statuses={[...orderStatuses] as OrderStatus[]} />;
}
