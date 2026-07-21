import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveSurcharges, resolveRates, resolveNightWindow, netShiftHours } from "@/lib/pricing";
import { candidatesForShift } from "@/lib/orders";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import type { ShiftMeta } from "@/components/orders/shift-meta-cell";
import { formatDateDE } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);

// Admins may edit a request at any time — no cutoff, even after shifts ran.
export default async function AdminEditRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
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
          address: true,
          surchargeSat: true,
          surchargeSun: true,
          surchargeHoliday: true,
          surchargeNight: true,
          nightStart: true,
          nightEnd: true,
          hourlyRates: true,
        },
      },
      assignments: {
        include: {
          worker: { select: { id: true, fullName: true, phone: true, photoPath: true, mealAllowanceEnabled: true, travelAllowanceEnabled: true } },
          serviceConfirmation: { select: { hoursWorked: true, correctionHours: true } },
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

  const initial = {
    requestGroupId: id,
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

  const shiftMeta: Record<string, ShiftMeta> = {};
  const slotByDate: Record<string, number> = {};
  orders.forEach((o, i) => {
    const date = d(o.shiftDate);
    const slot = slotByDate[date] ?? 0;
    slotByDate[date] = slot + 1;
    const confirmedCount = o.assignments.filter((a) => a.status === "confirmed").length;
    const selectable =
      !["cancelled", "completed", "confirmed"].includes(o.status) &&
      confirmedCount < o.quantity;
    shiftMeta[`${date}:${slot}`] = {
      orderId: o.id,
      status: o.status,
      quantity: o.quantity,
      label: `${formatDateDE(o.shiftDate)} · ${o.startTime}–${o.endTime}`,
      facilityName: o.client.facilityName,
      facilityAddress: o.client.address,
      ward: o.notes,
      shiftDate: formatDateDE(o.shiftDate),
      startTime: o.startTime,
      endTime: o.endTime,
      selectable,
      scheduledHours: netShiftHours(o.startTime, o.endTime, o.breakMinutes),
      assignments: o.assignments.map((a) => ({
        id: a.id,
        workerName: a.worker.fullName,
        status: a.status,
        hours: a.serviceConfirmation
          ? Number(a.serviceConfirmation.hoursWorked)
          : null,
        hasConfirmation: !!a.serviceConfirmation,
        addMealAllowance: a.addMealAllowance,
        excludeMealAllowance: a.excludeMealAllowance,
        excludeTravelAllowance: a.excludeTravelAllowance,
        bonusHours: a.bonusHours,
        correctionHours:
          a.serviceConfirmation?.correctionHours != null
            ? Number(a.serviceConfirmation.correctionHours)
            : null,
        worker: {
          id: a.worker.id,
          fullName: a.worker.fullName,
          phone: a.worker.phone,
          hasPhoto: !!a.worker.photoPath,
          mealAllowanceEnabled: a.worker.mealAllowanceEnabled,
          travelAllowanceEnabled: a.worker.travelAllowanceEnabled,
        },
      })),
      candidates: candidates[i],
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/orders/${id}`} />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
      </div>
      <OrderRequestBuilder
        initial={initial}
        surcharges={resolveSurcharges(orders[0].client)}
        rates={resolveRates(orders[0].client)}
        nightWindow={resolveNightWindow(orders[0].client)}
        adminEdit
        backHref={`/admin/orders/${id}`}
        shiftMeta={shiftMeta}
      />
    </div>
  );
}
