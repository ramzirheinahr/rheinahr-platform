import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isRequestCancelable, resolveAdminOrderRoute } from "@/lib/orders";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { CancelRequestButton } from "@/components/orders/cancel-request-button";
import { formatDateDE } from "@/lib/utils";
import { ArrowLeft, Pencil } from "lucide-react";
import { CopyPublicLinkButton } from "@/components/admin/copy-public-link-button";
import { SendOrderEmailButton } from "@/components/admin/send-order-email-button";
import { ScheduleSkeleton } from "@/components/admin/skeletons/schedule-skeleton";
import { OrderDetailContent } from "./components/order-detail-content";
import {
  OrderPdfExportDialog,
  type SelectableOrderShift,
} from "@/components/admin/order-pdf-export-dialog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AdminRequestDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  // Resolve route using shared helper: supports both request groups and standalone orders without 404
  const routeData = await resolveAdminOrderRoute(id);
  if (!routeData) notFound();

  const {
    firstOrder,
    isGroupOrder,
    targetGroupId,
    allOrdersInGroup,
    canExecuteGroupActions,
  } = routeData;

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

  const queryMonth = typeof search?.month === "string" && /^\d{4}-\d{2}$/.test(search.month) ? search.month : null;
  const orderShiftDate = allOrdersInGroup[0]?.shiftDate;
  const orderMonth = orderShiftDate
    ? `${orderShiftDate.getUTCFullYear()}-${String(orderShiftDate.getUTCMonth() + 1).padStart(2, "0")}`
    : `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
  const returnMonth = queryMonth || orderMonth;

  const shiftsForExport = await prisma.order.findMany({
    where: {
      OR: [
        { requestGroupId: targetGroupId },
        { id: targetGroupId },
      ],
    },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
      notes: true,
      status: true,
      assignments: {
        select: {
          worker: {
            select: {
              fullName: true,
            },
          },
        },
      },
    },
  });

  const exportShifts: SelectableOrderShift[] = shiftsForExport.map((s) => ({
    id: s.id,
    shiftDate: s.shiftDate.toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    requiredQualification: s.requiredQualification,
    ward: s.notes,
    status: s.status,
    workerName:
      s.assignments.length > 0
        ? s.assignments.map((a) => a.worker.fullName).join(", ")
        : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/orders?month=${returnMonth}`} />}
          >
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
          {canExecuteGroupActions ? (
            <>
              <OrderPdfExportDialog
                requestGroupId={targetGroupId}
                shifts={exportShifts}
                facilityName={facility}
              />
              <SendOrderEmailButton
                requestGroupId={targetGroupId}
                facilityName={facility}
              />
              <CopyPublicLinkButton
                requestGroupId={targetGroupId}
                type="confirm"
                defaultStartDate={d(allOrdersInGroup[0].shiftDate)}
                defaultEndDate={d(allOrdersInGroup[allOrdersInGroup.length - 1].shiftDate)}
                employees={employees}
              />
              {isRequestCancelable(allOrdersInGroup) ? (
                <CancelRequestButton requestGroupId={targetGroupId} admin />
              ) : null}
              <Button className="gap-2" render={<Link href={`/admin/orders/${targetGroupId}/edit?month=${returnMonth}`} />}>
                <Pencil className="size-4" />
                {c("edit")}
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                {t("singleOrderBadge")}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {t("singleOrderNotice")}
              </span>
            </div>
          )}
        </div>
      </div>

      <Suspense fallback={<ScheduleSkeleton />}>
        <OrderDetailContent
          requestGroupId={targetGroupId}
          defaultMonth={returnMonth}
          isGroupOrder={isGroupOrder}
        />
      </Suspense>
    </div>
  );
}

const d = (date: Date) => date.toISOString().slice(0, 10);
