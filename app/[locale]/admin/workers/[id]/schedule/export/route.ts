import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildPayrollPdfData } from "@/lib/payroll-pdf-builder";
import { generatePayrollPdf } from "@/lib/pdf/payroll";
import { requireRole } from "@/lib/auth";
import type { Locale } from "@/i18n/routing";
import { getWorkerMonthSchedule } from "@/lib/worker-schedule";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ locale: string; id: string }> }
) {
  const { locale, id } = await params;
  
  const user = await requireRole(locale as Locale, "admin");

  const url = new URL(req.url);
  const yearStr = url.searchParams.get("year");
  const monthStr = url.searchParams.get("month");

  if (!yearStr || !monthStr) {
    return new NextResponse("Missing year or month", { status: 400 });
  }

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  const worker = await prisma.worker.findUnique({
    where: { id },
  });

  if (!worker) {
    return new NextResponse("Worker not found", { status: 404 });
  }

  const { rows } = await getWorkerMonthSchedule(worker.id, year, month);

  // Include all shifts (confirmed + pending)
  const validRows = rows;

  const pdfData = buildPayrollPdfData(worker, validRows, year, month);
  const pdfBuffer = await generatePayrollPdf(pdfData);

  const filename = `Abrechnung_${worker.fullName.replace(/[^a-z0-9]/gi, '_')}_${month.toString().padStart(2, '0')}-${year}.pdf`;

  return new NextResponse(pdfBuffer as any, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
