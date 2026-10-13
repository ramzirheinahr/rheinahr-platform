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
import { isV2InvoiceIssuanceEnabled } from "@/lib/invoice-v2-issuance-service";
import { isV2CalculationVersion } from "@/lib/invoice-calculation-version";
import { resolveStoredPdfCandidatePath } from "@/lib/invoicing";
import {
  defaultFileVerifier,
  isCompleteFrozenSnapshot,
  verifyStoredHistoricalPdf,
} from "@/lib/invoice-v2-refresh-service";
import { OrderConfirmationsBanner } from "@/components/admin/order-confirmations-banner";

const d = (date: Date) => date.toISOString().slice(0, 10);

export async function OrderDetailContent({
  requestGroupId,
  defaultMonth,
  isGroupOrder = true,
}: {
  requestGroupId: string;
  defaultMonth?: string | null;
  isGroupOrder?: boolean;
}) {
  const id = requestGroupId;

  let defaultYear: number | undefined;
  let defaultMonthNum: number | undefined;
  if (defaultMonth && /^\d{4}-\d{2}$/.test(defaultMonth)) {
    const [yStr, mStr] = defaultMonth.split("-");
    defaultYear = Number(yStr);
    defaultMonthNum = Number(mStr);
  }

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { requestGroupId: id },
        { id: id },
      ],
    },
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
          order: {
            OR: [
              { requestGroupId: id },
              { id: id },
            ],
          },
        },
      },
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
          order: {
            OR: [
              { requestGroupId: id },
              { id: id },
            ],
          },
        },
      },
    },
  });

  // Match the PDF route's historical-origin checks before offering a document action.
  const invoiceDocumentStates = await Promise.all(
    invoices.map(async (invoice) => {
      let documentAvailable = isV2CalculationVersion(invoice.snapshotData);
      if (!documentAvailable) {
        const storedPath = resolveStoredPdfCandidatePath(invoice);
        if (storedPath) {
          const verification = await verifyStoredHistoricalPdf(
            storedPath,
            invoice.snapshotData,
            defaultFileVerifier
          );
          documentAvailable = verification.reliable;
        } else {
          const snapshot = await isCompleteFrozenSnapshot(
            invoice.snapshotData,
            {
              netAmount: Number(invoice.netAmount),
              vatAmount: Number(invoice.vatAmount),
              grossAmount: Number(invoice.grossAmount),
              date: invoice.date,
              invoiceNumber: invoice.invoiceNumber,
            },
            { skipPdfSimulation: true }
          );
          documentAvailable = snapshot.complete;
        }
      }
      return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        documentAvailable,
      };
    })
  );

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
        endTime: o.endTime,
        hasConfirmation: !!a.serviceConfirmation,
      }))
  );

  const initial = {
    requestGroupId: id,
    qual: orders[0].requiredQualification,
    shifts: orders.map((o) => ({
      id: o.id,
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
      {isGroupOrder ? (
        <>
          <OrderContractsBanner
            requestGroupId={id}
            contracts={contracts}
            uncontractedAssignments={uncontractedAssignments}
          />

          <OrderConfirmationsBanner
            requestGroupId={id}
            assignments={confirmedAssignments}
          />

        </>
      ) : null}

      <OrderInvoicesBanner
        requestGroupId={id}
        v2Enabled={isV2InvoiceIssuanceEnabled()}
        invoices={invoiceDocumentStates}
        uninvoicedAssignments={uninvoicedAssignments}
      />

      <PendingResponsesProvider>
        <AssignSelectionProvider selectableOrderIds={selectableOrderIds}>
          <OrderRequestBuilder
            initial={initial}
            defaultYear={defaultYear}
            defaultMonth={defaultMonthNum}
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
