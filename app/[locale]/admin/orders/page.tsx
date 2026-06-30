import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";

export const dynamic = "force-dynamic";

type OrderRow = Awaited<ReturnType<typeof getOrders>>[number];

async function getOrders() {
  try {
    return await prisma.order.findMany({
      orderBy: [{ status: "asc" }, { shiftDate: "asc" }],
      include: {
        client: { select: { facilityName: true } },
        _count: { select: { assignments: true } },
      },
    });
  } catch {
    return [];
  }
}

export default async function AdminOrdersPage() {
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const orders = await getOrders();

  const columns: Column<OrderRow>[] = [
    { header: t("facility"), primary: true, cell: (o) => o.client.facilityName },
    { header: t("shiftDate"), cell: (o) => o.shiftDate.toISOString().slice(0, 10) },
    { header: t("shiftTime"), cell: (o) => `${o.startTime}–${o.endTime}` },
    { header: t("qualification"), cell: (o) => eq(o.requiredQualification) },
    {
      header: t("assignedWorkers"),
      cell: (o) => `${o._count.assignments} / ${o.quantity}`,
    },
    { header: t("status"), cell: (o) => <OrderStatusBadge status={o.status} /> },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (o) => (
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/admin/orders/${o.id}`} />}
        >
          {t("detailTitle")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ResponsiveTable
        columns={columns}
        rows={orders}
        getRowKey={(o) => o.id}
        empty={t("empty")}
      />
    </div>
  );
}
