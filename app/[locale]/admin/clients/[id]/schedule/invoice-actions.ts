"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } from "@/lib/pricing";

const VAT_RATE = 0.19;

export async function generateMonthInvoices(clientId: string, year: number, month: number) {
  const user = await requireRole("de", "admin"); // Locale doesn't matter for role check here
  
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  
  const client = await prisma.client.findUnique({
    where: { id: clientId }
  });
  if (!client) throw new Error("Client not found");

  // We only invoice shifts that are confirmed, have NO invoice yet, and have a signed service confirmation
  const assignments = await prisma.assignment.findMany({
    where: {
      order: {
        clientId,
        shiftDate: { gte: startDate, lt: endDate }
      },
      invoiceId: null,
      status: "confirmed",
      serviceConfirmation: {
        isNot: null // Meaning it has been confirmed by the client
      }
    },
    include: {
      order: true,
      worker: true
    }
  });

  if (assignments.length === 0) {
    throw new Error("Keine abrechenbaren Schichten gefunden.");
  }

  // Calculate totals
  const rates = resolveRates(client);
  const surcharges = resolveSurcharges(client);
  const nightWindow = resolveNightWindow(client);
  
  const shiftsToPrice = assignments.map(a => ({
    shiftDate: a.order.shiftDate,
    startTime: a.order.startTime,
    endTime: a.order.endTime,
    breakMinutes: a.order.breakMinutes || 30,
    quantity: 1,
    requiredQualification: a.order.requiredQualification
  }));
  
  const netAmount = requestNetTotal(shiftsToPrice, surcharges, rates, nightWindow);
  const vatAmount = netAmount * VAT_RATE;
  const grossAmount = netAmount + vatAmount;

  // Generate invoice number
  // Format: INV-YYYYMM-[ShortCode or ID]-Seq
  const seqCount = await prisma.invoice.count({
    where: {
      date: { gte: startDate, lt: endDate }
    }
  });
  const seqNumber = String(seqCount + 1).padStart(4, "0");
  const monthStr = String(month).padStart(2, "0");
  const identifier = client.shortCode || client.id.substring(0, 4).toUpperCase();
  const invoiceNumber = `279-${identifier}-${year}${monthStr}-${seqNumber}`;

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      invoiceNumber,
      netAmount,
      vatAmount,
      grossAmount,
      status: "unpaid",
      date: new Date()
    }
  });

  // Link assignments to the invoice
  await prisma.assignment.updateMany({
    where: {
      id: { in: assignments.map(a => a.id) }
    },
    data: {
      invoiceId: invoice.id
    }
  });

  await audit({
    userId: user.id,
    action: "invoice.generate",
    entity: "Invoice",
    entityId: invoice.id,
    metadata: { assignmentCount: assignments.length, grossAmount }
  });

  // Notify client via in-app notification (for inbox)
  // They can click it to go to their schedule page where the invoice is shown
  await prisma.notification.create({
    data: {
      userId: client.userId,
      type: "order_status_changed", // We can reuse a type or add a new one in DB, using order_status_changed as a generic one
      channel: "in_app",
      content: `Eine neue Rechnung (${invoiceNumber}) für ${monthStr}.${year} steht zur Verfügung.`,
      link: `/client/schedule?year=${year}&month=${month}`
    }
  });

  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id };
}
