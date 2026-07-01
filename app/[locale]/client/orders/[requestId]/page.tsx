import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isRequestEditable } from "@/lib/orders";
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
import { ArrowLeft, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);

export default async function ClientRequestDetail({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const oq = await getTranslations("orderRequest");
  const eq = await getTranslations("enums.qualification");

  const user = await getCurrentUser();
  if (!user) notFound();
  const client = await prisma.client
    .findUnique({ where: { userId: user.id }, select: { id: true } })
    .catch(() => null);
  if (!client) notFound();

  const orders = await prisma.order.findMany({
    where: { requestGroupId: requestId, clientId: client.id },
    orderBy: { shiftDate: "asc" },
    select: {
      id: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
      quantity: true,
      notes: true,
      status: true,
      _count: { select: { assignments: true } },
    },
  });
  if (orders.length === 0) notFound();

  const editable = isRequestEditable(orders);
  const range =
    d(orders[0].shiftDate) === d(orders[orders.length - 1].shiftDate)
      ? d(orders[0].shiftDate)
      : `${d(orders[0].shiftDate)} – ${d(orders[orders.length - 1].shiftDate)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href="/client/orders" />}
          >
            <ArrowLeft className="size-4" />
            {c("back")}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {range} · {orders.length} {t("shiftsCount")}
            </p>
          </div>
        </div>
        {editable ? (
          <Button
            className="gap-2"
            render={<Link href={`/client/orders/${requestId}/edit`} />}
          >
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("shiftDate")}</TableHead>
              <TableHead>{t("shiftTime")}</TableHead>
              <TableHead>{t("qualification")}</TableHead>
              <TableHead>{oq("count")}</TableHead>
              <TableHead>{oq("ward")}</TableHead>
              <TableHead>{t("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{d(o.shiftDate)}</TableCell>
                <TableCell>{o.startTime}–{o.endTime}</TableCell>
                <TableCell>{eq(o.requiredQualification)}</TableCell>
                <TableCell>{o.quantity}</TableCell>
                <TableCell>{o.notes || c("none")}</TableCell>
                <TableCell><OrderStatusBadge status={o.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
