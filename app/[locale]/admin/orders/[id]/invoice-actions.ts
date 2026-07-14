"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } from "@/lib/pricing";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { sendEmailToUsers } from "@/lib/email";

const VAT_RATE = 0.19;

export async function deleteInvoice(invoiceId: string) {
  const user = await requireRole("de", "admin");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { assignments: true },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }

  // Release the assignments (the invoiceId will become null)
  await prisma.$transaction([
    prisma.assignment.updateMany({
      where: { invoiceId },
      data: { invoiceId: null },
    }),
    prisma.invoice.delete({
      where: { id: invoiceId },
    }),
  ]);

  await audit({
    userId: user.id,
    action: "invoice.delete",
    entity: "Invoice",
    entityId: invoiceId,
    metadata: { assignmentCount: invoice.assignments.length }
  });

  revalidatePath("/", "layout");
}

export async function generateOrderInvoices(assignmentIds: string[]) {
  const user = await requireRole("de", "admin");
  
  if (!assignmentIds || assignmentIds.length === 0) {
    throw new Error("Keine Schichten ausgewählt.");
  }

  // Find all invoiceable assignments
  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      invoiceId: null,
      status: "confirmed",
      serviceConfirmation: {
        isNot: null // Meaning it has been confirmed by the client
      }
    },
    include: {
      order: {
        include: { client: true }
      },
      worker: true
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (assignments.length === 0) {
    throw new Error("Die ausgewählten Schichten sind ungültig oder bereits abgerechnet.");
  }

  // Verify all assignments belong to the same client
  const client = assignments[0].order.client;
  const clientId = client.id;
  const requestGroupId = assignments[0].order.requestGroupId;
  
  if (assignments.some(a => a.order.clientId !== clientId)) {
    throw new Error("Alle ausgewählten Schichten müssen zum selben Kunden gehören.");
  }
  const firstDate = assignments[0].order.shiftDate;
  const lastDate = assignments[assignments.length - 1].order.shiftDate;
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(d);
  
  let periodLabel = formatDate(firstDate);
  if (firstDate.getTime() !== lastDate.getTime()) {
    periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
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

  const seqCount = await prisma.invoice.count();
  const seqNumber = String(seqCount + 400);
  const identifier = client.internalNumber || client.shortCode || client.id.substring(0, 4).toUpperCase();
  const monthStr = String(firstDate.getUTCMonth() + 1).padStart(2, "0");
  const yearStr = String(firstDate.getUTCFullYear()).slice(-2);
  const invoiceNumber = `${seqNumber}-${identifier}-${monthStr}${yearStr}`;

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
  await prisma.notification.create({
    data: {
      userId: client.userId,
      type: "order_status_changed", 
      channel: "in_app",
      content: `Eine neue Rechnung (${invoiceNumber}) für die Bestellung (${periodLabel}) steht zur Verfügung.`,
      link: `/client/orders/${requestGroupId}`
    }
  });

  // ----------------------------------------------------
  // Generate PDF for Email Attachment
  // ----------------------------------------------------
  const pdfData = buildInvoicePdfData(invoice, client, assignments);
  const pdfBuffer = await generateInvoicePdf(pdfData);

  // Send Email with Attachment
  await sendEmailToUsers([client.userId], {
    subject: `Rechnung ${invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
    body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoiceNumber}) für Ihre bestätigten Schichten (${periodLabel}).\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
    url: `/client/orders/${requestGroupId}`,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });

  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id };
}
