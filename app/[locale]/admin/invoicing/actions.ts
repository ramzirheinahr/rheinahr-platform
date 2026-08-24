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
