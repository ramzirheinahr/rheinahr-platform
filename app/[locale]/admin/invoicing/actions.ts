"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isV2CalculationVersion } from "@/lib/invoice-calculation-version";

export async function toggleInvoiceStatus(invoiceId: string, status: "paid" | "unpaid") {
  const user = await requireRole("de", "admin"); // any admin can do this

  const current = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true },
  });
  if (!current) return { ok: false as const, error: "notFound" };
  if (current.status === "cancelled") return { ok: false as const, error: "cancelled" };
  if (current.status === status) return { ok: true as const };

  const updated = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: current.status },
    data: { status },
  });
  if (updated.count !== 1) return { ok: false as const, error: "conflict" };

  await audit({
    userId: user.id,
    action: "invoice.status_update",
    entity: "Invoice",
    entityId: current.id,
    metadata: { previousStatus: current.status, status }
  });

  revalidatePath("/admin/invoicing");
  revalidatePath("/admin");
  return { ok: true as const };
}

const VAT_RATE = 0.19;

export async function updateInvoiceAction(params: {
  invoiceId: string;
  netAdjustment?: number;
  adjustmentReason?: string;
}) {
  const user = await requireRole("de", "admin");
  const { invoiceId, netAdjustment = 0, adjustmentReason = "" } = params;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      assignments: {
        include: {
          order: true,
          worker: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }
  if (isV2CalculationVersion(invoice.snapshotData)) {
    throw new Error("V2-Rechnungen sind unveränderlich. Bitte stornieren und nach Prüfung neu ausstellen.");
  }

  // Calculate base net amount from assignments
  const client = invoice.client;
  const snapshot = invoice.snapshotData && typeof invoice.snapshotData === "object" && !Array.isArray(invoice.snapshotData)
    ? invoice.snapshotData as Record<string, unknown>
    : null;
  const snapshotNumber = (key: string) => snapshot && typeof snapshot[key] === "number" ? snapshot[key] as number : null;
  const snapshotText = (key: string) => snapshot && typeof snapshot[key] === "string" ? snapshot[key] as string : null;
  const rates = snapshot?.hourlyRates ? {
    hourlyRates: snapshot.hourlyRates,
    surchargeSat: snapshotNumber("surchargeSat"),
    surchargeSun: snapshotNumber("surchargeSun"),
    surchargeHoliday: snapshotNumber("surchargeHoliday"),
    surchargeNight: snapshotNumber("surchargeNight"),
    nightStart: snapshotText("nightStart"),
    nightEnd: snapshotText("nightEnd"),
  } : client;
  const { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } = await import("@/lib/pricing");
  const resolvedRates = resolveRates(rates);
  const resolvedSurcharges = resolveSurcharges(rates);
  const resolvedNightWindow = resolveNightWindow(rates);

  let baseNet = 0;
  if (invoice.assignments.length > 0) {
    const shiftsToPrice = invoice.assignments.map((a) => ({
      shiftDate: a.order.shiftDate,
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      breakMinutes: a.order.breakMinutes ?? 30,
      quantity: 1,
      requiredQualification: a.order.requiredQualification,
    }));
    baseNet = requestNetTotal(shiftsToPrice, resolvedSurcharges, resolvedRates, resolvedNightWindow,
      snapshot && Object.hasOwn(snapshot, "billingHolidayCalendar") ? snapshot.billingHolidayCalendar : undefined);
  } else {
    // If no assignments are directly linked (e.g. legacy), fallback to existing net minus any previous adjustment
    const prevAdj = snapshotNumber("netAdjustment") || 0;
    baseNet = invoice.netAmount - prevAdj;
  }

  const finalNet = Math.round((baseNet + netAdjustment) * 100) / 100;
  const finalVat = Math.round(finalNet * VAT_RATE * 100) / 100;
  const finalGross = Math.round((finalNet + finalVat) * 100) / 100;

  const currentSnapshot = snapshot || {};
  const updatedSnapshot = {
    ...currentSnapshot,
    netAdjustment,
    adjustmentReason: adjustmentReason.trim(),
    baseNetAmount: baseNet,
  };

  const updatedInvoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      netAmount: finalNet,
      vatAmount: finalVat,
      grossAmount: finalGross,
      snapshotData: updatedSnapshot,
    },
  });

  await audit({
    userId: user.id,
    action: "invoice.update",
    entity: "Invoice",
    entityId: invoiceId,
    metadata: {
      previousNet: invoice.netAmount,
      newNet: finalNet,
      netAdjustment,
      adjustmentReason,
    },
  });

  revalidatePath("/admin/invoicing");
  revalidatePath("/admin");
  return { ok: true, invoice: updatedInvoice };
}

export async function generateInvoiceForShift(assignmentId: string) {
  const { generateOrderInvoices } = await import("@/app/[locale]/admin/orders/[id]/invoice-actions");
  const res = await generateOrderInvoices([assignmentId]);
  revalidatePath("/admin/invoicing");
  return res;
}


