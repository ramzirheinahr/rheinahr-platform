import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { hasReliableInvoiceDocument } from "@/lib/invoicing";

import { defaultFileVerifier } from "@/lib/invoice-v2-refresh-service";

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
          order: true,
        },
        orderBy: { order: { shiftDate: "asc" } },
      },
    },
  });

  if (!invoice) return new NextResponse("Not found", { status: 404 });

  const url = new URL(_req.url);
  const revisionQuery = url.searchParams.get("revision");

  // Step: Historical Revision Retrieval (Admin-only)
  if (revisionQuery !== null) {
    if (!roleSatisfies(user.role, ["admin"])) {
      return new NextResponse(
        "Forbidden: Nur Administratoren dürfen historische Revisionsfassungen einsehen.",
        { status: 403 }
      );
    }

    const revisionNumber = parseInt(revisionQuery, 10);
    if (isNaN(revisionNumber) || revisionNumber < 0) {
      return new NextResponse("Ungültige Revisionsnummer", { status: 400 });
    }

    const isDownload = url.searchParams.get("download") === "true";
    const disposition = isDownload ? "attachment" : "inline";

    if (revisionNumber === 0) {
      // Baseline historical state before any revisions
      const rev1 = await prisma.invoiceRevision.findUnique({
        where: {
          invoiceId_revisionNumber: {
            invoiceId: id,
            revisionNumber: 1,
          },
        },
      });

      if (!rev1) {
        return new NextResponse("Historische Ausgangsversion nicht gefunden", { status: 404 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prevProvenance = rev1.previousSnapshotData as any;
      if (!prevProvenance || typeof prevProvenance !== "object") {
        return new NextResponse("Keine verlässlichen Snapshot-Daten für diese Revision hinterlegt", {
          status: 422,
        });
      }

      // Case A: Stored original PDF file verified and served as-is (exact original bytes)
      // Case A: Stored original PDF file verified and served as-is (exact original bytes)
      if (prevProvenance.originReliability === "stored_pdf") {
        const filePath =
          prevProvenance.storedPdfInfo?.archivedPath ||
          prevProvenance.archivedPdfRecord?.archivedPath ||
          prevProvenance.storedPdfInfo?.path ||
          prevProvenance.pdfUrl ||
          prevProvenance.rawSnapshotData?.pdfUrl ||
          prevProvenance.rawSnapshotData?.pdfFilePath;

        if (!filePath || typeof filePath !== "string") {
          return new NextResponse(
            "Das archivierte Originaldokument hat keinen hinterlegten Dateipfad.",
            { status: 409 }
          );
        }

        const fileCheck = defaultFileVerifier(filePath);
        if (!fileCheck.exists || !fileCheck.buffer || !fileCheck.sha256 || !fileCheck.byteLength) {
          return new NextResponse(
            `Das archivierte Originaldokument wurde nicht auf dem Server gefunden oder ist ungültig: ${fileCheck.reason || "Datei nicht lesbar"}`,
            { status: 409 }
          );
        }

        // Strict checksum and byte length verification against archived metadata
        const expectedSha256 = prevProvenance.storedPdfInfo?.sha256 || prevProvenance.archivedPdfRecord?.sha256;
        const expectedByteLength = prevProvenance.storedPdfInfo?.byteLength || prevProvenance.archivedPdfRecord?.byteLength;

        if (expectedSha256 && fileCheck.sha256 !== expectedSha256) {
          return new NextResponse(
            `Das archivierte Originaldokument wurde auf dem Server verändert oder ist beschädigt (Checksum-Mismatch: erwartet ${expectedSha256}, vorgefunden ${fileCheck.sha256}).`,
            { status: 409 }
          );
        }

        if (expectedByteLength && fileCheck.byteLength !== expectedByteLength) {
          return new NextResponse(
            `Das archivierte Originaldokument hat eine abweichende Dateigröße (Größen-Mismatch: erwartet ${expectedByteLength} Bytes, vorgefunden ${fileCheck.byteLength} Bytes).`,
            { status: 409 }
          );
        }

        await audit({
          userId: user.id,
          action: "invoice.pdf_revision",
          entity: "InvoiceRevision",
          entityId: rev1.id,
          metadata: { invoiceId: id, revisionNumber: 0, source: "stored_original_file", sha256: fileCheck.sha256 },
        });

        return new NextResponse(new Uint8Array(fileCheck.buffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${disposition}; filename="Rechnung-${prevProvenance.invoiceNumber || invoice.invoiceNumber}-Original.pdf"`,
            "X-Document-Source": "stored_original_file",
            "X-Document-Checksum": fileCheck.sha256,
            "Cache-Control": "no-store",
          },
        });
      }

      // Case B: Regenerated strictly from frozen snapshot data (independent of live client modifications)
      if (prevProvenance.originReliability === "frozen_snapshot") {
        const rawSnap = prevProvenance.rawSnapshotData || prevProvenance;
        const facilityName =
          prevProvenance.client?.facilityName ||
          rawSnap.facilityName ||
          rawSnap.client?.facilityName;

        const address =
          prevProvenance.client?.address ||
          rawSnap.address ||
          rawSnap.client?.address;

        if (!facilityName || !address) {
          return new NextResponse(
            "Historische Ausgangsversion unvollständig: Mandantendaten (facilityName oder address) fehlen im archivierten Snapshot.",
            { status: 422 }
          );
        }

        const frozenClient = {
          id: prevProvenance.client?.id || prevProvenance.clientId || "HISTORICAL-CLIENT",
          shortCode: prevProvenance.client?.shortCode || rawSnap.shortCode || null,
          internalNumber: prevProvenance.client?.internalNumber || rawSnap.internalNumber || null,
          facilityName,
          address,
          billingEmail: prevProvenance.client?.billingEmail || rawSnap.billingEmail || null,
          billingInfo: prevProvenance.client?.billingInfo || rawSnap.billingInfo || null,
          paymentTermsDays: prevProvenance.client?.paymentTermsDays ?? rawSnap.paymentTermsDays ?? 14,
          hourlyRates: {},
          surchargeSat: 0,
          surchargeSun: 0,
          surchargeHoliday: 0,
          surchargeNight: 0,
          nightStart: "22:00",
          nightEnd: "06:00",
        };

        const invoiceForRevision = {
          invoiceNumber: prevProvenance.invoiceNumber || rawSnap.invoiceNumber || invoice.invoiceNumber,
          date: prevProvenance.date ? new Date(prevProvenance.date) : (rawSnap.date ? new Date(rawSnap.date) : invoice.date),
          netAmount: rev1.previousNetAmount,
          vatAmount: rev1.previousVatAmount,
          grossAmount: rev1.previousGrossAmount,
          snapshotData: rawSnap,
        };

        // Strict: Never pass live client or live assignments
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfData = buildInvoicePdfData(invoiceForRevision as any, frozenClient as any, []);
        const pdfBuffer = await generateInvoicePdf(pdfData);

        await audit({
          userId: user.id,
          action: "invoice.pdf_revision",
          entity: "InvoiceRevision",
          entityId: rev1.id,
          metadata: { invoiceId: id, revisionNumber: 0, source: "regenerated_from_frozen_snapshot" },
        });

        return new NextResponse(new Uint8Array(pdfBuffer), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${disposition}; filename="Rechnung-${invoiceForRevision.invoiceNumber}-Rev0.pdf"`,
            "X-Document-Source": "regenerated_from_frozen_snapshot",
            "X-Document-Is-Byte-Original": "false",
            "Cache-Control": "no-store",
          },
        });
      }

      return new NextResponse(
        "Keine verlässliche historische Ausgangsversion (weder gültige Originaldatei noch vollständiger Snapshot).",
        { status: 422 }
      );
    }

    // Successive Revisions (revisionNumber >= 1)
    const revision = await prisma.invoiceRevision.findUnique({
      where: {
        invoiceId_revisionNumber: {
          invoiceId: id,
          revisionNumber: revisionNumber,
        },
      },
    });

    if (!revision) {
      return new NextResponse("Revisionsfassung nicht gefunden", { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revSnapshot = revision.newSnapshotData as any;
    if (!revSnapshot || typeof revSnapshot !== "object") {
      return new NextResponse("Keine verlässlichen Snapshot-Daten für diese Revision hinterlegt", {
        status: 422,
      });
    }

    // Build client strictly from frozen revision snapshot
    const frozenClient = revSnapshot.client || {
      id: invoice.client.id,
      shortCode: revSnapshot.shortCode ?? invoice.client.shortCode,
      internalNumber: revSnapshot.internalNumber ?? invoice.client.internalNumber,
      facilityName: revSnapshot.facilityName ?? invoice.client.facilityName,
      address: revSnapshot.address ?? invoice.client.address,
      billingEmail: revSnapshot.billingEmail ?? invoice.client.billingEmail,
      billingInfo: revSnapshot.billingInfo ?? invoice.client.billingInfo,
      paymentTermsDays: revSnapshot.paymentTermsDays ?? invoice.client.paymentTermsDays,
    };

    const invoiceForRevision = {
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      netAmount: revision.newNetAmount,
      vatAmount: revision.newVatAmount,
      grossAmount: revision.newGrossAmount,
      snapshotData: revSnapshot,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfData = buildInvoicePdfData(invoiceForRevision as any, frozenClient as any, []);
    const pdfBuffer = await generateInvoicePdf(pdfData);

    await audit({
      userId: user.id,
      action: "invoice.pdf_revision",
      entity: "InvoiceRevision",
      entityId: revision.id,
      metadata: { invoiceId: id, revisionNumber },
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="Rechnung-${invoice.invoiceNumber}-Rev${revisionNumber}.pdf"`,
        "X-Document-Source": "frozen_revision_snapshot",
        "Cache-Control": "no-store",
      },
    });
  }

  // Standard Current Invoice PDF path
  const allowed = roleSatisfies(user.role, ["admin"]) || invoice.client.userId === user.id;
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  if (invoice.status === "cancelled" && !hasReliableInvoiceDocument(invoice)) {
    return new NextResponse(
      "Für diese stornierte Rechnung ist keine verlässliche historische Fassung verfügbar (keine eingefrorenen Posten im Snapshot gespeichert).",
      { status: 422 }
    );
  }

  const pdfData = buildInvoicePdfData(invoice, invoice.client, invoice.assignments);
  const pdfBuffer = await generateInvoicePdf(pdfData);

  await audit({
    userId: user.id,
    action: "invoice.pdf",
    entity: "Invoice",
    entityId: invoice.id,
  });

  const isDownload = url.searchParams.get("download") === "true";
  const disposition = isDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="Rechnung-${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
