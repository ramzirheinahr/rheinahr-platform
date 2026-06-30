import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
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
import { Plus } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/client/orders/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("emptyClient")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shiftDate")}</TableHead>
                <TableHead>{t("shiftTime")}</TableHead>
                <TableHead>{t("qualification")}</TableHead>
                <TableHead>{t("quantity")}</TableHead>
                <TableHead>{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.shiftDate.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    {o.startTime}–{o.endTime}
                  </TableCell>
                  <TableCell>{eq(o.requiredQualification)}</TableCell>
                  <TableCell>{o.quantity}</TableCell>
                  <TableCell>
                    <OrderStatusBadge status={o.status} />
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
