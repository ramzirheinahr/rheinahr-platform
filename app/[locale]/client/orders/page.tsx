import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Plus } from "lucide-react";

type OrderRow = Awaited<ReturnType<typeof getOrders>>[number];

export const dynamic = "force-dynamic";

async function getOrders() {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const client = await prisma.client.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!client) return [];
    return await prisma.order.findMany({
      where: { clientId: client.id },
      orderBy: { shiftDate: "desc" },
      include: { _count: { select: { assignments: true } } },
    });
  } catch {
    return [];
  }
}

export default async function ClientOrdersPage() {
  const t = await getTranslations("orders");
  const eq = await getTranslations("enums.qualification");
  const orders = await getOrders();

  const columns: Column<OrderRow>[] = [
    {
      header: t("shiftDate"),
      primary: true,
      cell: (o) => o.shiftDate.toISOString().slice(0, 10),
    },
    { header: t("shiftTime"), cell: (o) => `${o.startTime}–${o.endTime}` },
    { header: t("qualification"), cell: (o) => eq(o.requiredQualification) },
    { header: t("quantity"), cell: (o) => o.quantity },
    { header: t("status"), cell: (o) => <OrderStatusBadge status={o.status} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/client/orders/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={orders}
        getRowKey={(o) => o.id}
        empty={t("emptyClient")}
      />
    </div>
  );
}
