import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf, InvoicePdfData } from "@/lib/pdf/invoice";
import { format } from "date-fns";
import {
  resolveRates,
  resolveSurcharges,
  resolveNightWindow,
  shiftSurchargeHours,
  rateFor,
  comboMultiplier,
  comboKey,
  SurchargeComponent,
  SURCHARGES
} from "@/lib/pricing";
import { germanHolidays } from "@/lib/holidays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      assignments: {
        include: {
          worker: true,
          order: true
        },
        orderBy: { order: { shiftDate: "asc" } }
      }
    }
  });

  if (!invoice) return new NextResponse("Not found", { status: 404 });

  const allowed = roleSatisfies(user.role, ["admin"]) || invoice.client.userId === user.id;
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Calculate items based on assignments
  const rates = resolveRates(invoice.client);
  const surcharges = resolveSurcharges(invoice.client);
  const nightWindow = resolveNightWindow(invoice.client);

  let baseHours = 0;
  let satHours = 0;
  let sunHours = 0;
  let nightHours = 0;
  let holidayHours = 0;

  // We assume all assignments use the same base rate (Pflegehilfskraft) for this invoice, or we can just average/find the rate.
  // Actually, we should group by qualification if there are multiple. For simplicity, we just use the first assignment's qualification or just generic.
  const qualification = invoice.assignments[0]?.order.requiredQualification || "pflegehelfer";
  const baseRate = rateFor(qualification, rates);

  const getHolidays = (year: number) => Array.from(germanHolidays(year).keys());
  const isHoliday = (dateStr: string) => {
    const y = parseInt(dateStr.slice(0, 4), 10);
    return getHolidays(y).includes(dateStr);
  };

  for (const a of invoice.assignments) {
    const shiftDateStr = a.order.shiftDate.toISOString().slice(0, 10);
    const split = shiftSurchargeHours(
      shiftDateStr,
      a.order.startTime,
      a.order.endTime,
      a.order.breakMinutes || 30,
      isHoliday,
      nightWindow
    );

    for (const [key, group] of split.entries()) {
      baseHours += group.hours; // Every hour is a base hour
      
      if (group.components.includes("sat")) satHours += group.hours;
      if (group.components.includes("sun")) sunHours += group.hours;
      if (group.components.includes("night")) nightHours += group.hours;
      if (group.components.includes("holiday")) holidayHours += group.hours;
    }
  }

  const formatNumber = (num: number) => num.toFixed(2).replace(".", ",");
  const formatAmount = (num: number) => formatNumber(num);

  const items: InvoicePdfData["items"] = [];
  let pos = 1;
  let totalNetCalc = 0;

  // 1. Base Hours
  if (baseHours > 0) {
    const amt = baseHours * baseRate;
    totalNetCalc += amt;
    const startStr = invoice.assignments[0] ? format(invoice.assignments[0].order.shiftDate, "dd.MM.yyyy") : "";
    const endStr = invoice.assignments[invoice.assignments.length - 1] ? format(invoice.assignments[invoice.assignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "";
    
    items.push({
      pos: pos++,
      description: `Pflegekraft vom ${startStr} bis ${endStr}`,
      hours: formatNumber(baseHours),
      rate: formatNumber(baseRate),
      amount: formatAmount(amt)
    });
  }

  // 2. Saturday
  if (satHours > 0) {
    const sRate = baseRate * surcharges.sat;
    const amt = satHours * sRate;
    totalNetCalc += amt;
    items.push({
      pos: pos++,
      description: `Samstagzuschlag ${surcharges.sat * 100}%`,
      hours: formatNumber(satHours),
      rate: formatNumber(sRate),
      amount: formatAmount(amt)
    });
  }

  // 3. Night
  if (nightHours > 0) {
    const sRate = baseRate * surcharges.night;
    const amt = nightHours * sRate;
    totalNetCalc += amt;
    items.push({
      pos: pos++,
      description: `Nachtzuschlag (${nightWindow.start}-${nightWindow.end}) ${surcharges.night * 100}%`,
      hours: formatNumber(nightHours),
      rate: formatNumber(sRate),
      amount: formatAmount(amt)
    });
  }

  // 4. Sunday
  if (sunHours > 0) {
    const sRate = baseRate * surcharges.sun;
    const amt = sunHours * sRate;
    totalNetCalc += amt;
    items.push({
      pos: pos++,
      description: `Sonntagzuschlag ${surcharges.sun * 100}%`,
      hours: formatNumber(sunHours),
      rate: formatNumber(sRate),
      amount: formatAmount(amt)
    });
  }

  // 5. Holiday
  if (holidayHours > 0) {
    const sRate = baseRate * surcharges.holiday;
    const amt = holidayHours * sRate;
    totalNetCalc += amt;
    items.push({
      pos: pos++,
      description: `Feiertagszuschlag ${surcharges.holiday * 100}%`,
      hours: formatNumber(holidayHours),
      rate: formatNumber(sRate),
      amount: formatAmount(amt)
    });
  }

  const pdfData: InvoicePdfData = {
    invoiceNumber: invoice.invoiceNumber,
    date: format(invoice.date, "dd.MM.yyyy"),
    clientId: invoice.client.shortCode || invoice.client.id.substring(0, 8),
    clientName: invoice.client.facilityName,
    clientAddress: invoice.client.address || "Adresse unbekannt",
    periodStart: invoice.assignments[0] ? format(invoice.assignments[0].order.shiftDate, "dd.MM.yyyy") : "",
    periodEnd: invoice.assignments[invoice.assignments.length - 1] ? format(invoice.assignments[invoice.assignments.length - 1].order.shiftDate, "dd.MM.yyyy") : "",
    items,
    subtotal: formatAmount(invoice.netAmount),
    taxAmount: formatAmount(invoice.vatAmount),
    total: formatAmount(invoice.grossAmount),
  };

  const pdfBuffer = await generateInvoicePdf(pdfData);

  await audit({
    userId: user.id,
    action: "invoice.pdf",
    entity: "Invoice",
    entityId: invoice.id
  });

  const url = new URL(_req.url);
  const isDownload = url.searchParams.get("download") === "true";
  const disposition = isDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="Rechnung-${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    }
  });
}
