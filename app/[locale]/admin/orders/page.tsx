import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("facility")}</TableHead>
                <TableHead>{t("shiftDate")}</TableHead>
                <TableHead>{t("shiftTime")}</TableHead>
                <TableHead>{t("qualification")}</TableHead>
                <TableHead>{t("assignedWorkers")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-end">{c("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.client.facilityName}
                  </TableCell>
                  <TableCell>{o.shiftDate.toISOString().slice(0, 10)}</TableCell>
                  <TableCell>
                    {o.startTime}–{o.endTime}
                  </TableCell>
                  <TableCell>{eq(o.requiredQualification)}</TableCell>
                  <TableCell>
                    {o._count.assignments} / {o.quantity}
                  </TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      render={<Link href={`/admin/orders/${o.id}`} />}
                    >
                      {t("detailTitle")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
