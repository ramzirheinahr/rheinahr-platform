import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { candidatesForShift } from "@/lib/orders";
import { resolveSurcharges, resolveRates } from "@/lib/pricing";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import type { ShiftMeta } from "@/components/orders/shift-meta-cell";
import { formatDateDE } from "@/lib/utils";
import { ArrowLeft, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);

export default async function AdminRequestDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  const orders = await prisma.order.findMany({
    where: { requestGroupId: id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    include: {
      client: {
        select: {
          facilityName: true,
          surchargeSat: true,
          surchargeSun: true,
          surchargeHoliday: true,
        hourlyRates: true,
        },
      },
      assignments: {
        include: {
          worker: { select: { fullName: true } },
          serviceConfirmation: { select: { hoursWorked: true } },
        },
      },
    },
  });
  if (orders.length === 0) notFound();

  const candidates = await Promise.all(
    orders.map((o) =>
      candidatesForShift({
        id: o.id,
        shiftDate: o.shiftDate,
        startTime: o.startTime,
        endTime: o.endTime,
        requiredQualification: o.requiredQualification,
      }),
    ),
  );

  const facility = orders[0].client.facilityName;
  const firstDate = formatDateDE(orders[0].shiftDate);
  const lastDate = formatDateDE(orders[orders.length - 1].shiftDate);
  const range = firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

  const initial = {
    requestGroupId: id,
    qual: orders[0].requiredQualification,
    shifts: orders.map((o) => ({
      date: d(o.shiftDate),
      start: o.startTime,
      end: o.endTime,
      quantity: o.quantity,
      bereich: o.notes ?? "",
    })),
  };

  // Per-shift pipeline data for the table's status column, keyed like the
  // builder's cells (`${date}:${slot}` — same order as `initial.shifts`).
  const shiftMeta: Record<string, ShiftMeta> = {};
  const slotByDate: Record<string, number> = {};
  orders.forEach((o, i) => {
    const date = d(o.shiftDate);
    const slot = slotByDate[date] ?? 0;
    slotByDate[date] = slot + 1;
    shiftMeta[`${date}:${slot}`] = {
      orderId: o.id,
      status: o.status,
      quantity: o.quantity,
      label: `${formatDateDE(o.shiftDate)} · ${o.startTime}–${o.endTime}`,
      assignments: o.assignments.map((a) => ({
        id: a.id,
        workerName: a.worker.fullName,
        status: a.status,
        hours: a.serviceConfirmation
          ? Number(a.serviceConfirmation.hoursWorked)
          : null,
      })),
      candidates: candidates[i],
    };
  });

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
              {range} · {orders.length} {t("shiftsCount")}
            </p>
          </div>
        </div>
        <Button className="gap-2" render={<Link href={`/admin/orders/${id}/edit`} />}>
          <Pencil className="size-4" />
          {c("edit")}
        </Button>
      </div>

      {/* The request in the same shape as when it was created; each shift row
          carries its status chip, which opens the assignment dialog. */}
      <OrderRequestBuilder
        initial={initial}
        surcharges={resolveSurcharges(orders[0].client)}
        rates={resolveRates(orders[0].client)}
        readOnly
        backHref={`/admin/orders/${id}`}
        shiftMeta={shiftMeta}
        assignable
      />
    </div>
  );
}
