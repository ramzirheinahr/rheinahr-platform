import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isRequestCancelable } from "@/lib/orders";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CancelRequestButton } from "@/components/orders/cancel-request-button";
import { formatDateDE } from "@/lib/utils";
import { ArrowLeft, Pencil, Download } from "lucide-react";
import { CopyPublicLinkButton } from "@/components/admin/copy-public-link-button";
import { ScheduleSkeleton } from "@/components/admin/skeletons/schedule-skeleton";
import { OrderDetailContent } from "./components/order-detail-content";

export const dynamic = "force-dynamic";

export default async function AdminRequestDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  // Fast fetch just for the header info
  const firstOrder = await prisma.order.findFirst({
    where: { requestGroupId: id },
    orderBy: { shiftDate: "asc" },
    select: {
      id: true,
      shiftDate: true,
      status: true,
      client: {
        select: {
          id: true,
          userId: true,
          facilityName: true,
        },
      },
    }
  });

  if (!firstOrder) notFound();

  const allOrdersInGroup = await prisma.order.findMany({
    where: { requestGroupId: id },
    orderBy: { shiftDate: "asc" },
    select: { shiftDate: true, status: true }
  });

  const clientOwner = await prisma.user.findUnique({
    where: { id: firstOrder.client.userId },
    select: { id: true, fullName: true, email: true }
  });
  
  const clientUsers = await prisma.user.findMany({
    where: { clientId: firstOrder.client.id },
    select: { id: true, fullName: true, email: true }
  });

  const employees: { id: string, name: string }[] = [];
  if (clientOwner) employees.push({ id: clientOwner.id, name: clientOwner.fullName || clientOwner.email });
  for (const u of clientUsers) {
    employees.push({ id: u.id, name: u.fullName || u.email });
  }

  const facility = firstOrder.client.facilityName;
  const firstDate = formatDateDE(allOrdersInGroup[0].shiftDate);
  const lastDate = formatDateDE(allOrdersInGroup[allOrdersInGroup.length - 1].shiftDate);
  const range = firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-2" render={<Link href="/admin/orders" />}>
            <ArrowLeft className="size-4" />
            {c("back")}
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{facility}</h1>
            <p className="text-sm text-muted-foreground">
              {range} · {allOrdersInGroup.length} {t("shiftsCount")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            render={<a href={`/api/exports/order-request/${id}?format=pdf`} target="_blank" />}
          >
            <Download className="size-4" />
            PDF
          </Button>
          <CopyPublicLinkButton 
            requestGroupId={id} 
            type="confirm" 
            defaultStartDate={d(allOrdersInGroup[0].shiftDate)}
            defaultEndDate={d(allOrdersInGroup[allOrdersInGroup.length - 1].shiftDate)}
            employees={employees}
          />
          {isRequestCancelable(allOrdersInGroup) ? (
            <CancelRequestButton requestGroupId={id} admin />
          ) : null}
          <Button className="gap-2" render={<Link href={`/admin/orders/${id}/edit`} />}>
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        </div>
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <OrderDetailContent requestGroupId={id} />
      </Suspense>
    </div>
  );
}

const d = (date: Date) => date.toISOString().slice(0, 10);
