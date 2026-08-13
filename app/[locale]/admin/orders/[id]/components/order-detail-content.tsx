import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { candidatesForShift } from "@/lib/orders";
import {
  resolveSurcharges,
  resolveRates,
  resolveNightWindow,
  netShiftHours,
} from "@/lib/pricing";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { AssignSelectionProvider } from "@/components/orders/assign-selection";
import { PendingResponsesProvider } from "@/components/orders/pending-responses-provider";
import type { ShiftMeta } from "@/components/orders/shift-meta-cell";
import { formatDateDE } from "@/lib/utils";
import { OrderContractsBanner } from "@/components/admin/order-contracts-banner";
import { OrderInvoicesBanner } from "@/components/admin/order-invoices-banner";
import { OrderConfirmationsBanner } from "@/components/admin/order-confirmations-banner";

const d = (date: Date) => date.toISOString().slice(0, 10);

export async function OrderDetailContent({
  requestGroupId,
}: {
  requestGroupId: string;
}) {
  const t = await getTranslations("orders");
  const id = requestGroupId;

  const orders = await prisma.order.findMany({
    where: { requestGroupId: id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    include: {
      client: {
        select: {
          id: true,
          userId: true,
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
          worker: { select: { id: true, fullName: true, phone: true, photoPath: true, mealAllowanceType: true, travelAllowanceEnabled: true } },
          serviceConfirmation: { select: { hoursWorked: true, correctionHours: true, method: true } },
        },
      },
    },
  });
  
  if (orders.length === 0) return null;

  const candidates: Awaited<ReturnType<typeof candidatesForShift>>[] = [];
  for (const o of orders) {
    candidates.push(
      await candidatesForShift({
        id: o.id,
        shiftDate: o.shiftDate,
        startTime: o.startTime,
        endTime: o.endTime,
        requiredQualification: o.requiredQualification,
      })
    );
  }

  const contracts = await prisma.clientContract.findMany({
    where: {
      assignments: {
        some: {
          order: { requestGroupId: id }
        }
      }
    },
    include: {
      client: true,
      assignments: {
        include: { order: true, worker: true }
      }
    }
  });

  const invoices = await prisma.invoice.findMany({
    where: {
      assignments: {
        some: {
          order: { requestGroupId: id }
        }
      }
    }
  });

  const uncontractedAssignments = orders.flatMap(o => 
    o.assignments
      .filter(a => a.status === "confirmed" && !a.contractId)
      .map(a => ({
        id: a.id,
        workerName: a.worker.fullName,
        shiftDate: formatDateDE(o.shiftDate),
        startTime: o.startTime,
        endTime: o.endTime
      }))
  );

  const uninvoicedAssignments = orders.flatMap(o =>
    o.assignments
      .filter(a => a.status === "confirmed" && !a.invoiceId)
      .map(a => ({
        id: a.id,
        workerName: a.worker.fullName,
        shiftDate: formatDateDE(o.shiftDate),
        startTime: o.startTime,
        endTime: o.endTime
      }))
  );

  const confirmedAssignments = orders.flatMap(o =>
    o.assignments
      .filter(a => a.status === "confirmed")
      .map(a => ({
        id: a.id,
        workerName: a.worker.fullName,
        shiftDate: formatDateDE(o.shiftDate),
        startTime: o.startTime,
        endTime: o.endTime
      }))
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
  const selectableOrderIds: string[] = [];
  
  orders.forEach((o, i) => {
    const date = d(o.shiftDate);
    const slot = slotByDate[date] ?? 0;
    slotByDate[date] = slot + 1;
    const confirmedCount = o.assignments.filter((a) => a.status === "confirmed").length;
    const selectable =
      !["cancelled", "completed", "confirmed"].includes(o.status) &&
      confirmedCount < o.quantity;
    if (selectable) selectableOrderIds.push(o.id);
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
      breakMinutes: o.breakMinutes,
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
        confirmationMethod: a.serviceConfirmation?.method,
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
          mealAllowanceType: a.worker.mealAllowanceType,
          travelAllowanceEnabled: a.worker.travelAllowanceEnabled,
        },
      })),
      candidates: candidates[i],
    };
  });

  return (
    <>
      <OrderContractsBanner 
        requestGroupId={id} 
        contracts={contracts} 
        uncontractedAssignments={uncontractedAssignments} 
      />

      <OrderConfirmationsBanner 
        assignments={confirmedAssignments}
      />

      <OrderInvoicesBanner 
        requestGroupId={id} 
        invoices={invoices} 
        uninvoicedAssignments={uninvoicedAssignments} 
      />

      <PendingResponsesProvider>
        <AssignSelectionProvider selectableOrderIds={selectableOrderIds}>
          <OrderRequestBuilder
            initial={initial}
            surcharges={resolveSurcharges(orders[0].client)}
            rates={resolveRates(orders[0].client)}
            nightWindow={resolveNightWindow(orders[0].client)}
            readOnly
            backHref={`/admin/orders/${id}`}
            shiftMeta={shiftMeta}
            assignable
          />
        </AssignSelectionProvider>
      </PendingResponsesProvider>
    </>
  );
}
