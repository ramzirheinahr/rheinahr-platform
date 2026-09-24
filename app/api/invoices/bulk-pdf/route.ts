import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!roleSatisfies(user.role, ["admin"])) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const q = url.searchParams.get("q")?.trim() || "";

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const pad = (n: number) => String(n).padStart(2, "0");

  const defFrom = `${y}-${pad(m + 1)}-01`;
  const defTo = `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`;

  const fromDateStr = fromStr || defFrom;
  const toDateStr = toStr || defTo;

  const from = new Date(`${fromDateStr}T00:00:00.000Z`);
  const to = new Date(`${toDateStr}T23:59:59.999Z`);

  const words = q.split(/\s+/).filter(Boolean);

  const invoiceWhere: any = {
    date: { gte: from, lte: to },
  };

  if (words.length > 0) {
    invoiceWhere.AND = words.map((w) => ({
      OR: [
        { invoiceNumber: { contains: w, mode: "insensitive" } },
        { client: { facilityName: { contains: w, mode: "insensitive" } } },
      ],
    }));
  }

  const invoices = await prisma.invoice.findMany({
    where: invoiceWhere,
    include: {
      client: true,
      assignments: {
        include: {
          worker: true,
          order: true,
        },
        orderBy: { order: { shiftDate: "asc" } },
      },
    },
    orderBy: { date: "desc" },
  });

  if (invoices.length === 0) {
    return new NextResponse("Keine Rechnungen im angegebenen Zeitraum gefunden.", {
      status: 404,
    });
  }

  const mergedPdf = await PDFDocument.create();

  for (const inv of invoices) {
    try {
      const pdfData = buildInvoicePdfData(inv, inv.client, inv.assignments);
      const pdfBuffer = await generateInvoicePdf(pdfData);
      const doc = await PDFDocument.load(pdfBuffer);
      const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err) {
      console.error(`Error generating PDF for invoice ${inv.invoiceNumber}:`, err);
    }
  }

  const mergedPdfBytes = await mergedPdf.save();

  await audit({
    userId: user.id,
    action: "invoice.bulk_pdf",
    entity: "Invoice",
    metadata: {
      count: invoices.length,
      from: fromDateStr,
      to: toDateStr,
    },
  });

  return new NextResponse(new Uint8Array(mergedPdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Rechnungen_${fromDateStr}_${toDateStr}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
