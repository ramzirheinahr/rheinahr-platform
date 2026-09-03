"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal } from "@/lib/pricing";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { sendEmailToRecipients } from "@/lib/email";
import { generateLeistungsnachweisePdf } from "@/lib/pdf/generate-timesheets-pdf";
import { generateUniqueInvoiceNumber } from "@/lib/invoicing";

const VAT_RATE = 0.19;

export async function sendInvoiceEmail({
  invoiceId,
  recipients,
  attachTimesheets = true,
}: {
  invoiceId: string;
  recipients?: string[];
  attachTimesheets?: boolean;
}) {
  await requireRole("de", "admin");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: {
        include: {
          user: true,
          subUsers: true,
        }
      },
      assignments: {
        include: {
          order: true,
          worker: true,
        },
        orderBy: { order: { shiftDate: "asc" } },
      },
    },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }

  const client = invoice.client;
  const pdfData = buildInvoicePdfData(invoice, client, invoice.assignments);
  const pdfBuffer = await generateInvoicePdf(pdfData);

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [
    {
      filename: `${invoice.invoiceNumber}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    },
  ];

  if (attachTimesheets && invoice.assignments.length > 0) {
    const assignmentIds = invoice.assignments.map((a) => a.id);
    const timesheetBuffer = await generateLeistungsnachweisePdf(assignmentIds);
    if (timesheetBuffer) {
      attachments.push({
        filename: `Leistungsnachweise_${invoice.invoiceNumber}.pdf`,
        content: timesheetBuffer,
        contentType: "application/pdf",
      });
    }
  }

  const targetRecipients = recipients && recipients.length > 0 ? recipients : [client.userId];

  await sendEmailToRecipients(targetRecipients, {
    subject: `Rechnung ${invoice.invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
    body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoice.invoiceNumber})${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
    attachments,
  });

  return { ok: true };
}

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

export async function cancelInvoice(invoiceId: string) {
  const user = await requireRole("de", "admin");

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { assignments: true },
  });

  if (!invoice) {
    throw new Error("Rechnung nicht gefunden.");
  }

  // Release the assignments so they can be re-invoiced and mark invoice as cancelled
  await prisma.$transaction([
    prisma.assignment.updateMany({
      where: { invoiceId },
      data: { invoiceId: null },
    }),
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "cancelled" },
    }),
  ]);

  await audit({
    userId: user.id,
    action: "invoice.cancel",
    entity: "Invoice",
    entityId: invoiceId,
    metadata: { assignmentCount: invoice.assignments.length }
  });

  revalidatePath("/", "layout");
}

export async function generateOrderInvoices(
  assignmentIds: string[],
  customInvoiceNumber?: string,
  recipients?: string[],
  attachTimesheets: boolean = true
) {
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
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
  
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

  const identifier = client.internalNumber || client.shortCode || client.id.substring(0, 4).toUpperCase();
  const invoiceNumber = await generateUniqueInvoiceNumber({
    identifier,
    date: firstDate,
    customInvoiceNumber,
  });

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      clientId,
      invoiceNumber,
      netAmount,
      vatAmount,
      grossAmount,
      status: "unpaid",
      date: new Date(),
      snapshotData: {
        shortCode: client.shortCode,
        internalNumber: client.internalNumber,
        facilityName: client.facilityName,
        address: client.address,
        billingInfo: client.billingInfo,
        hourlyRates: client.hourlyRates,
        surchargeSat: client.surchargeSat,
        surchargeSun: client.surchargeSun,
        surchargeHoliday: client.surchargeHoliday,
        surchargeNight: client.surchargeNight,
        nightStart: client.nightStart,
        nightEnd: client.nightEnd,
        paymentTermsDays: client.paymentTermsDays,
      } as any
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

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [
    {
      filename: `${invoiceNumber}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf"
    }
  ];

  if (attachTimesheets && assignments.length > 0) {
    const timesheetBuffer = await generateLeistungsnachweisePdf(assignments.map(a => a.id));
    if (timesheetBuffer) {
      attachments.push({
        filename: `Leistungsnachweise_${invoiceNumber}.pdf`,
        content: timesheetBuffer,
        contentType: "application/pdf"
      });
    }
  }

  const targetRecipients = recipients && recipients.length > 0 ? recipients : [client.userId];

  // Send Email with Attachment (non-fatal if SMTP fails)
  try {
    await sendEmailToRecipients(targetRecipients, {
      subject: `Rechnung ${invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
      body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoiceNumber}) für Ihre bestätigten Schichten (${periodLabel})${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
      url: `/client/orders/${requestGroupId}`,
      attachments
    });
  } catch (emailErr) {
    console.error("Fehler beim Versenden der Rechnungs-E-Mail:", emailErr);
  }

  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id };
}

