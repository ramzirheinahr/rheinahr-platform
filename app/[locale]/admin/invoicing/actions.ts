"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function toggleInvoiceStatus(invoiceId: string, status: "paid" | "unpaid") {
  const user = await requireRole("de", "admin"); // any admin can do this

  const invoice = await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status }
  });

  await audit({
    userId: user.id,
    action: "invoice.status_update",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: { status }
  });

  revalidatePath("/admin/invoicing");
  return { ok: true };
}
