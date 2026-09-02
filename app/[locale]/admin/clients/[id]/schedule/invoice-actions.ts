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

const VAT_RATE = 0.19;

export async function generateMonthInvoices(
  clientId: string,
  year: number,
  month: number,
  customInvoiceNumber?: string,
  recipients?: string[],
  attachTimesheets: boolean = true
) {
  const user = await requireRole("de", "admin"); // Locale doesn't matter for role check here
  
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  
  const client = await prisma.client.findUnique({
    where: { id: clientId }
  });
  if (!client) throw new Error("Client not found");

  // We only invoice shifts that are confirmed and have NO invoice yet.
  const assignments = await prisma.assignment.findMany({
    where: {
      order: {
        clientId,
        shiftDate: { gte: startDate, lt: endDate }
      },
      invoiceId: null,
      status: "confirmed",
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
  const seqCount = await prisma.invoice.count();
  const seqNumber = String(seqCount + 304).padStart(4, "0");
  const monthStr = String(month).padStart(2, "0");
  const identifier = client.shortCode || client.id.substring(0, 4).toUpperCase();
  const generatedNumber = `279-${identifier}-${year}${monthStr}-${seqNumber}`;
  const invoiceNumber = customInvoiceNumber && customInvoiceNumber.trim() !== "" 
    ? customInvoiceNumber.trim() 
    : generatedNumber;

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

  // Send Email with Attachment
  await sendEmailToRecipients(targetRecipients, {
    subject: `Rechnung ${invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
    body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoiceNumber}) für Ihre bestätigten Schichten im ${monthStr}.${year}${attachTimesheets ? " inklusive der zugehörigen Leistungsnachweise" : ""}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
    url: `/client/schedule?year=${year}&month=${month}`,
    attachments
  });

  revalidatePath("/", "layout");
  return { ok: true, invoiceId: invoice.id };
}

