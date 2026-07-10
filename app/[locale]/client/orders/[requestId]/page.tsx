import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isRequestEditable, isRequestCancelable } from "@/lib/orders";
import {
  resolveSurcharges,
  resolveRates,
  resolveNightWindow,
  netShiftHours,
} from "@/lib/pricing";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { RequestMessageButton } from "@/components/client/request-message-button";
import { CancelRequestButton } from "@/components/orders/cancel-request-button";
import { LiveRefresher } from "@/components/portal/live-refresher";
import type { ShiftMeta } from "@/components/orders/shift-meta-cell";
import { formatDateDE } from "@/lib/utils";
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

  const user = await getCurrentUser();
  if (!user) notFound();
  const client = await prisma.client
    .findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
        hourlyRates: true,
      },
    })
    .catch(() => null);
  if (!client) notFound();

  const orders = await prisma.order.findMany({
    where: { requestGroupId: requestId, clientId: client.id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      breakMinutes: true,
      requiredQualification: true,
      quantity: true,
      notes: true,
      status: true,
      assignments: {
        select: {
          id: true,
          status: true,
          serviceConfirmation: { select: { id: true, correctionHours: true } },
          worker: {
            select: { id: true, fullName: true, photoPath: true },
          },
        },
      },
    },
  });
  if (orders.length === 0) notFound();

  const editable = isRequestEditable(orders);
  const cancelable = isRequestCancelable(orders);
  const first = formatDateDE(orders[0].shiftDate);
  const last = formatDateDE(orders[orders.length - 1].shiftDate);
  const range = first === last ? first : `${first} – ${last}`;

  const initial = {
    requestGroupId: requestId,
    qual: orders[0].requiredQualification,
    shifts: orders.map((o) => ({
      date: d(o.shiftDate),
      start: o.startTime,
      end: o.endTime,
      pause: o.breakMinutes,
      quantity: o.quantity,
      bereich: o.notes ?? "",
    })),
  };

  // Per-shift status for the table's status column (keyed like builder cells).
  const shiftMeta: Record<string, ShiftMeta> = {};
  const slotByDate: Record<string, number> = {};
  for (const o of orders) {
    const date = d(o.shiftDate);
    const slot = slotByDate[date] ?? 0;
    slotByDate[date] = slot + 1;
    const [eh, em] = o.endTime.split(":").map(Number);
    const endDateTime = new Date(o.shiftDate);
    endDateTime.setUTCHours(eh, em, 0, 0);
    // eslint-disable-next-line react-hooks/purity
    const isPast = Date.now() > endDateTime.getTime();
    const scheduledHours = netShiftHours(o.startTime, o.endTime, o.breakMinutes);

    shiftMeta[`${date}:${slot}`] = {
      orderId: o.id,
      status: o.status,
      quantity: o.quantity,
      label: `${formatDateDE(o.shiftDate)} · ${o.startTime}–${o.endTime}`,
      isPast,
      scheduledHours,
      assignments: o.assignments.map((a) => ({
        id: a.id,
        status: a.status,
        hasConfirmation: !!a.serviceConfirmation,
        correctionHours:
          a.serviceConfirmation?.correctionHours != null
            ? Number(a.serviceConfirmation.correctionHours)
            : null,
        worker: {
          id: a.worker.id,
          fullName: a.worker.fullName,
          hasPhoto: !!a.worker.photoPath,
        },
      })),
    };
  }

  return (
    <div className="space-y-6">
      <LiveRefresher tables={["orders", "assignments", "service_confirmations"]} />
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
        <div className="flex flex-wrap items-center gap-2">
          {cancelable ? <CancelRequestButton requestGroupId={requestId} /> : null}
          {editable ? (
            <Button
              className="gap-2"
              render={<Link href={`/client/orders/${requestId}/edit`} />}
            >
              <Pencil className="size-4" />
              {c("edit")}
            </Button>
          ) : (
            <RequestMessageButton requestGroupId={requestId} />
          )}
        </div>
      </div>

      <OrderRequestBuilder
        initial={initial}
        surcharges={resolveSurcharges(client)}
        rates={resolveRates(client)}
        nightWindow={resolveNightWindow(client)}
        readOnly
        backHref="/client/orders"
        shiftMeta={shiftMeta}
      />
    </div>
  );
}
