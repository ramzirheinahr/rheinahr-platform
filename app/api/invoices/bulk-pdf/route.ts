import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { PDFDocument } from "pdf-lib";
import { Prisma } from "@prisma/client";
import { resolveStoredPdfCandidatePath } from "@/lib/invoicing";

import {
  defaultFileVerifier,
  isCompleteFrozenSnapshot,
  buildFrozenClientFromSnapshot,
  verifyStoredHistoricalPdf,
} from "@/lib/invoice-v2-refresh-service";
import { isV2CalculationVersion } from "@/lib/invoice-calculation-version";

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
      const isV2 = isV2CalculationVersion(inv.snapshotData);
      let doc: PDFDocument;

      if (isV2) {
        // Current V2 invoice: strictly generate from frozen V2 snapshot, independent of legacy pdfUrl
        const pdfData = buildInvoicePdfData(inv, inv.client, inv.assignments);
        const pdfBuffer = await generateInvoicePdf(pdfData);
        doc = await PDFDocument.load(pdfBuffer);
      } else {
        // Historical pre-V2 invoice: check stored original PDF file
        const storedPdfPath = resolveStoredPdfCandidatePath(inv);

        if (storedPdfPath) {
          const verification = await verifyStoredHistoricalPdf(storedPdfPath, inv.snapshotData, defaultFileVerifier);
          if (!verification.reliable) {
            return new NextResponse(
              `Fehler beim Zusammenstellen der Sammel-PDF für Rechnung ${inv.invoiceNumber}: ${verification.reason}`,
              {
                status: verification.status,
                headers: {
                  "X-Invoice-Missing-Origin": "true",
                  "X-Error-Code": verification.errorCode,
                  "Cache-Control": "no-store",
                },
              }
            );
          }
          doc = await PDFDocument.load(verification.buffer);
        } else {
          // Strict Owner Decision (Option A): Block live recalculation from current shifts/rates.
          // In bulk bundle, historical invoices lacking a verified stored file MUST possess a complete frozen snapshot.
          const snapshotCheck = await isCompleteFrozenSnapshot(
            inv.snapshotData,
            {
              netAmount: Number(inv.netAmount),
              vatAmount: Number(inv.vatAmount),
              grossAmount: Number(inv.grossAmount),
              date: inv.date,
              invoiceNumber: inv.invoiceNumber,
            },
            { skipPdfSimulation: true }
          );

          if (!snapshotCheck.complete) {
            return new NextResponse(
              `Fehler beim Zusammenstellen der Sammel-PDF für Rechnung ${inv.invoiceNumber}: Weder ein verifiziertes Originaldokument noch ein vollständiger eingefrorener Snapshot hinterlegt. Die dynamische Neugenerierung aus Live-Daten ist zur Wahrung der Revisionssicherheit gesperrt. Bitte prüfen Sie das Buchhaltungsarchiv.`,
              {
                status: 422,
                headers: {
                  "X-Invoice-Missing-Origin": "true",
                  "X-Error-Code": "HISTORICAL_ORIGIN_UNAVAILABLE",
                  "Cache-Control": "no-store",
                },
              }
            );
          }

          // Build client identity strictly from frozen snapshot (zero live client leakage)
          const frozenClient = buildFrozenClientFromSnapshot(inv.snapshotData);
          if (!frozenClient) {
            return new NextResponse(
              `Fehler beim Zusammenstellen der Sammel-PDF für Rechnung ${inv.invoiceNumber}: Historischer Snapshot enthält keine vollständigen Mandantendaten (facilityName oder address fehlt).`,
              {
                status: 422,
                headers: {
                  "X-Invoice-Missing-Origin": "true",
                  "X-Error-Code": "INCOMPLETE_FROZEN_CLIENT",
                  "Cache-Control": "no-store",
                },
              }
            );
          }

          const snap = (inv.snapshotData as Record<string, unknown>) || {};
          const rawItems =
            Array.isArray(snap?.items) && snap.items.length > 0
              ? snap.items
              : Array.isArray(snap?.pdfItems) && snap.pdfItems.length > 0
              ? snap.pdfItems
              : [];

          const frozenInvoice = {
            invoiceNumber: (typeof snap?.invoiceNumber === "string" && snap.invoiceNumber) || inv.invoiceNumber,
            date: snap?.date ? new Date(snap.date as string) : inv.date,
            netAmount: inv.netAmount,
            vatAmount: inv.vatAmount,
            grossAmount: inv.grossAmount,
            snapshotData: {
              ...((inv.snapshotData as Record<string, unknown>) || {}),
              items: rawItems,
            },
          };

          // Strict: Never pass live client or live assignments
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pdfData = buildInvoicePdfData(frozenInvoice as any, frozenClient as any, []);
          const pdfBuffer = await generateInvoicePdf(pdfData);
          doc = await PDFDocument.load(pdfBuffer);
        }
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
