import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { PDFDocument } from "pdf-lib";
import { Prisma } from "@prisma/client";

import { defaultFileVerifier } from "@/lib/invoice-v2-refresh-service";

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

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    status: { not: "cancelled" },
    OR: [
      {
        assignments: {
          some: {
            order: {
              shiftDate: { gte: from, lte: to },
            },
          },
        },
      },
      {
        assignments: { none: {} },
        date: { gte: from, lte: to },
      },
    ],
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
    // Defense-in-depth: strictly exclude cancelled invoices even if returned
    if (inv.status === "cancelled") {
      continue;
    }

    try {
      const invRecord = inv as unknown as Record<string, unknown>;
      const snap = (inv.snapshotData && typeof inv.snapshotData === "object"
        ? inv.snapshotData
        : null) as Record<string, unknown> | null;
      const storedPdfPath =
        (typeof invRecord.pdfUrl === "string" && invRecord.pdfUrl.trim()) ||
        (typeof snap?.pdfUrl === "string" && snap.pdfUrl.trim()) ||
        (typeof snap?.pdfFilePath === "string" && snap.pdfFilePath.trim()) ||
        null;

      let doc: PDFDocument;

      if (storedPdfPath) {
        const fileCheck = defaultFileVerifier(storedPdfPath);
        if (!fileCheck.exists || !fileCheck.buffer) {
          // Fail closed: Never fall back to live rebuild when a stored original PDF is designated
          return new NextResponse(
            `Fehler beim Zusammenstellen der Sammel-PDF für Rechnung ${inv.invoiceNumber}: Das hinterlegte historische Rechnungsdokument ist nicht verfügbar oder beschädigt.`,
            { status: 422 }
          );
        }
        doc = await PDFDocument.load(fileCheck.buffer);
      } else {
        const pdfData = buildInvoicePdfData(inv, inv.client, inv.assignments);
        const pdfBuffer = await generateInvoicePdf(pdfData);
        doc = await PDFDocument.load(pdfBuffer);
      }

      const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err: unknown) {
      console.error(`Error generating PDF for invoice ${inv.invoiceNumber}:`, err);
      const errMsg = err instanceof Error ? err.message : "Ungültige Rechnungsdaten";
      // Fail closed: corrupted invoice snapshot or rendering failure must not produce incomplete bulk bundle
      return new NextResponse(
        `Fehler beim Zusammenstellen der Sammel-PDF für Rechnung ${inv.invoiceNumber}: ${errMsg}`,
        { status: 422 }
      );
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
