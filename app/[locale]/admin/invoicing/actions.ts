"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

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

  // Calculate base net amount from assignments
  const client = invoice.client;
  const rates = (invoice.snapshotData as any)?.hourlyRates ? invoice.snapshotData : client;
  const { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } = await import("@/lib/pricing");
  const resolvedRates = resolveRates(rates as any);
  const resolvedSurcharges = resolveSurcharges(rates as any);
  const resolvedNightWindow = resolveNightWindow(rates as any);

  let baseNet = 0;
  if (invoice.assignments.length > 0) {
    const shiftsToPrice = invoice.assignments.map((a) => ({
      shiftDate: a.order.shiftDate,
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      breakMinutes: a.order.breakMinutes || 30,
      quantity: 1,
      requiredQualification: a.order.requiredQualification as any,
    }));
    baseNet = requestNetTotal(shiftsToPrice, resolvedSurcharges, resolvedRates, resolvedNightWindow);
  } else {
    // If no assignments are directly linked (e.g. legacy), fallback to existing net minus any previous adjustment
    const prevAdj = (invoice.snapshotData as any)?.netAdjustment || 0;
    baseNet = invoice.netAmount - prevAdj;
  }

  const finalNet = Math.round((baseNet + netAdjustment) * 100) / 100;
  const finalVat = Math.round(finalNet * VAT_RATE * 100) / 100;
  const finalGross = Math.round((finalNet + finalVat) * 100) / 100;

  const currentSnapshot = (invoice.snapshotData as any) || {};
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

