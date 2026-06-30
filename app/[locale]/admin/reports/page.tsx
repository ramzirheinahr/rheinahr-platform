import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { orderStatuses } from "@/lib/validations";
import type { OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type Stats = {
  totalOrders: number;
  activeOrders: number;
  confirmedOrders: number;
  fulfillmentRate: number;
  totalWorkers: number;
  utilization: number;
  totalClients: number;
  activeClients: number;
  confirmedHours: number;
  acceptanceRate: number;
  byStatus: Record<string, number>;
  topClients: { name: string; count: number }[];
};

async function getStats(): Promise<Stats | null> {
  try {
    const [byStatusRaw, assignRaw, topRaw, workerGroups, clientGroups, hours, totalWorkers, totalClients] =
      await Promise.all([
        prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.assignment.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.order.groupBy({
          by: ["clientId"],
          _count: { clientId: true },
          orderBy: { _count: { clientId: "desc" } },
          take: 5,
        }),
        prisma.assignment.groupBy({ by: ["workerId"], where: { status: { not: "declined" } } }),
        prisma.order.groupBy({ by: ["clientId"] }),
        prisma.serviceConfirmation.aggregate({ _sum: { hoursWorked: true } }),
        prisma.worker.count(),
        prisma.client.count(),
      ]);

    const byStatus: Record<string, number> = {};
    let totalOrders = 0;
    for (const row of byStatusRaw) {
      byStatus[row.status] = row._count._all;
      totalOrders += row._count._all;
    }
    const cancelled = byStatus["cancelled"] ?? 0;
    const confirmedOrders = byStatus["confirmed"] ?? 0;
    const activeOrders = totalOrders - confirmedOrders - cancelled;
    const fulfillmentDenom = totalOrders - cancelled;
    const fulfillmentRate = fulfillmentDenom > 0 ? confirmedOrders / fulfillmentDenom : 0;

    const assignConfirmed = assignRaw.find((a) => a.status === "confirmed")?._count._all ?? 0;
    const assignDeclined = assignRaw.find((a) => a.status === "declined")?._count._all ?? 0;
    const acceptanceDenom = assignConfirmed + assignDeclined;
    const acceptanceRate = acceptanceDenom > 0 ? assignConfirmed / acceptanceDenom : 0;

    const utilization = totalWorkers > 0 ? workerGroups.length / totalWorkers : 0;

    const ids = topRaw.map((t) => t.clientId);
    const names = ids.length
      ? await prisma.client.findMany({
          where: { id: { in: ids } },
          select: { id: true, facilityName: true },
        })
      : [];
    const nameMap = new Map(names.map((n) => [n.id, n.facilityName]));
    const topClients = topRaw.map((t) => ({
      name: nameMap.get(t.clientId) ?? "—",
      count: t._count.clientId,
    }));

    return {
      totalOrders,
      activeOrders,
      confirmedOrders,
      fulfillmentRate,
      totalWorkers,
      utilization,
      totalClients,
      activeClients: clientGroups.length,
      confirmedHours: Number(hours._sum.hoursWorked ?? 0),
      acceptanceRate,
      byStatus,
      topClients,
    };
  } catch {
    return null;
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function ReportsPage() {
  const t = await getTranslations("reports");
  const es = await getTranslations("enums.orderStatus");
  const s = await getStats();

  const kpis = [
    { label: t("totalOrders"), value: s?.totalOrders ?? "—" },
    { label: t("activeOrders"), value: s?.activeOrders ?? "—" },
    { label: t("fulfillmentRate"), value: s ? pct(s.fulfillmentRate) : "—" },
    { label: t("acceptanceRate"), value: s ? pct(s.acceptanceRate) : "—" },
    { label: t("workers"), value: s?.totalWorkers ?? "—" },
    { label: t("utilization"), value: s ? pct(s.utilization) : "—" },
    { label: t("activeClients"), value: s ? `${s.activeClients} / ${s.totalClients}` : "—" },
    { label: t("confirmedHours"), value: s ? `${s.confirmedHours} h` : "—" },
  ];

  const maxStatus = s ? Math.max(1, ...Object.values(s.byStatus)) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {k.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-3xl font-bold">{k.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("ordersByStatus")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!s || s.totalOrders === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              orderStatuses
                .filter((st) => (s.byStatus[st] ?? 0) > 0)
                .map((st) => {
                  const count = s.byStatus[st] ?? 0;
                  return (
                    <div key={st} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{es(st as OrderStatus)}</span>
                        <span className="text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(count / maxStatus) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("topClients")}</CardTitle>
          </CardHeader>
          <CardContent>
            {!s || s.topClients.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              <ul className="divide-y">
                {s.topClients.map((c, i) => (
                  <li key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground">
                      {c.count} {t("orderCount")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
