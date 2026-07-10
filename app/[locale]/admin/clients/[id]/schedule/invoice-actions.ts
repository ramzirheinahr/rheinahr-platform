"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal, shiftSurchargeHours, rateFor } from "@/lib/pricing";
import { generateInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice";
import { format } from "date-fns";
import { germanHolidays } from "@/lib/holidays";
import { sendEmailToUsers } from "@/lib/email";

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

  // ----------------------------------------------------
  // Generate PDF for Email Attachment
  // ----------------------------------------------------
  let baseHours = 0, satHours = 0, sunHours = 0, nightHours = 0, holidayHours = 0;
  const qualification = assignments[0]?.order.requiredQualification || "pflegehelfer";
  const baseRate = rateFor(qualification, rates);

  const getHolidays = (year: number) => Array.from(germanHolidays(year).keys());
  const isHoliday = (dateStr: string) => getHolidays(parseInt(dateStr.slice(0, 4), 10)).includes(dateStr);

  for (const a of assignments) {
    const shiftDateStr = a.order.shiftDate.toISOString().slice(0, 10);
    const split = shiftSurchargeHours(shiftDateStr, a.order.startTime, a.order.endTime, a.order.breakMinutes || 30, isHoliday, nightWindow);
    for (const [key, group] of split.entries()) {
      baseHours += group.hours;
      if (group.components.includes("sat")) satHours += group.hours;
      if (group.components.includes("sun")) sunHours += group.hours;
      if (group.components.includes("holiday")) holidayHours += group.hours;
      if (group.components.includes("night")) nightHours += group.hours;
    }
  }

  const formatNumber = (num: number) => num.toFixed(2).replace(".", ",");
  const formatAmount = (num: number) => `${formatNumber(num)} €`;

  let pos = 1;
  const items: InvoicePdfData["items"] = [];

  if (baseHours > 0) {
    const startStr = assignments[0] ? format(assignments[0].order.shiftDate, "dd.MM.yyyy") : "";
    const endStr = assignments[assignments.length - 1] ? format(assignments[assignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "";
    items.push({ pos: pos++, description: `Pflegekraft vom ${startStr} bis ${endStr}`, hours: formatNumber(baseHours), rate: formatNumber(baseRate), amount: formatAmount(baseHours * baseRate) });
  }
  if (satHours > 0) {
    const sRate = baseRate * surcharges.sat;
    items.push({ pos: pos++, description: `Samstagzuschlag ${surcharges.sat * 100}%`, hours: formatNumber(satHours), rate: formatNumber(sRate), amount: formatAmount(satHours * sRate) });
  }
  if (nightHours > 0) {
    const sRate = baseRate * surcharges.night;
    items.push({ pos: pos++, description: `Nachtzuschlag (${nightWindow.start}-${nightWindow.end}) ${surcharges.night * 100}%`, hours: formatNumber(nightHours), rate: formatNumber(sRate), amount: formatAmount(nightHours * sRate) });
  }
  if (sunHours > 0) {
    const sRate = baseRate * surcharges.sun;
    items.push({ pos: pos++, description: `Sonntagzuschlag ${surcharges.sun * 100}%`, hours: formatNumber(sunHours), rate: formatNumber(sRate), amount: formatAmount(sunHours * sRate) });
  }
  if (holidayHours > 0) {
    const sRate = baseRate * surcharges.holiday;
    items.push({ pos: pos++, description: `Feiertagszuschlag ${surcharges.holiday * 100}%`, hours: formatNumber(holidayHours), rate: formatNumber(sRate), amount: formatAmount(holidayHours * sRate) });
  }

  const pdfData: InvoicePdfData = {
    invoiceNumber,
    date: format(new Date(), "dd.MM.yyyy"),
    clientId: client.shortCode || client.id.substring(0, 8),
    clientName: client.facilityName,
    clientAddress: client.address || "Adresse unbekannt",
    periodStart: assignments[0] ? format(assignments[0].order.shiftDate, "dd.MM.yyyy") : "",
    periodEnd: assignments[assignments.length - 1] ? format(assignments[assignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "",
    items,
    subtotal: formatAmount(netAmount),
    taxAmount: formatAmount(vatAmount),
    total: formatAmount(grossAmount),
  };

  const pdfBuffer = await generateInvoicePdf(pdfData);

  // Send Email with Attachment
  await sendEmailToUsers([client.userId], {
    subject: `Rechnung ${invoiceNumber} - RheinAhr Dienstleistungen GmbH`,
    body: `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie die offizielle Rechnung (${invoiceNumber}) für Ihre bestätigten Schichten im ${monthStr}.${year}.\n\nMit freundlichen Grüßen,\nIhr Team der RheinAhr Dienstleistungen GmbH`,
    url: `/client/schedule?year=${year}&month=${month}`,
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
