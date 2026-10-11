import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { hasReliableInvoiceDocument } from "@/lib/invoicing";

import { defaultFileVerifier } from "@/lib/invoice-v2-refresh-service";
import { isV2CalculationVersion } from "@/lib/invoice-calculation-version";

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
          prevProvenance.archivedPdfRecord?.archivedPath;

        if (!filePath || typeof filePath !== "string") {
          return new NextResponse(
            "Das archivierte Originaldokument hat keinen hinterlegten Archivpfad (archivedPath fehlt).",
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
        const snapClient = (rawSnap.client && typeof rawSnap.client === "object" ? rawSnap.client : null) as Record<string, unknown> | null;

        const facilityName =
          (typeof rawSnap.facilityName === "string" && rawSnap.facilityName.trim()) ||
          (typeof snapClient?.facilityName === "string" && snapClient.facilityName.trim()) ||
          (typeof prevProvenance.client?.facilityName === "string" && prevProvenance.client.facilityName.trim()) ||
          null;

        const address =
          (typeof rawSnap.address === "string" && rawSnap.address.trim()) ||
          (typeof snapClient?.address === "string" && snapClient.address.trim()) ||
          (typeof prevProvenance.client?.address === "string" && prevProvenance.client.address.trim()) ||
          null;

        if (!facilityName || !address) {
          return new NextResponse(
            "Historische Ausgangsversion unvollständig: Mandantendaten (facilityName oder address) fehlen im archivierten Snapshot.",
            { status: 422 }
          );
        }

        // Strict historical fidelity: Optional fields must come ONLY from historical snapshot.
        // If absent in historical snapshot, they remain null and must NEVER be populated from live client.
        const shortCode =
          (typeof rawSnap.shortCode === "string" && rawSnap.shortCode.trim()) ||
          (typeof snapClient?.shortCode === "string" && snapClient.shortCode.trim()) ||
          null;

        const internalNumber =
          (typeof rawSnap.internalNumber === "string" && rawSnap.internalNumber.trim()) ||
          (typeof snapClient?.internalNumber === "string" && snapClient.internalNumber.trim()) ||
          null;

        const billingInfo =
          (typeof rawSnap.billingInfo === "string" && rawSnap.billingInfo.trim()) ||
          (typeof snapClient?.billingInfo === "string" && snapClient.billingInfo.trim()) ||
          null;

        const billingEmail =
          (typeof rawSnap.billingEmail === "string" && rawSnap.billingEmail.trim()) ||
          (typeof snapClient?.billingEmail === "string" && snapClient.billingEmail.trim()) ||
          null;

        const paymentTermsDays =
          typeof rawSnap.paymentTermsDays === "number"
            ? rawSnap.paymentTermsDays
            : typeof snapClient?.paymentTermsDays === "number"
            ? snapClient.paymentTermsDays
            : 14;

        const frozenClient = {
          id: (snapClient?.id as string) || (rawSnap.clientId as string) || "HISTORICAL-CLIENT",
          shortCode,
          internalNumber,
          facilityName,
          address,
          billingEmail,
          billingInfo,
          paymentTermsDays,
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

  const isV2 = isV2CalculationVersion(invoice.snapshotData);

  // Case 1: Current V2 Invoice
  // Must render strictly from frozen V2 snapshot data (independent of any legacy pdfUrl on the invoice row).
  // The baseline historical file prior to refresh is preserved in invoiceRevision[revisionNumber=1].previousSnapshotData
  // and accessible via ?revision=0.
  if (isV2) {
    try {
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
          "X-Document-Source": "frozen_snapshot",
          "Cache-Control": "no-store",
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return new NextResponse(msg, { status: 422 });
    }
  }

  // Case 2: Historical Pre-V2 / Un-refreshed Invoice
  // Check if historical invoice has a verified stored original PDF file on disk
  const invoiceRecord = invoice as unknown as Record<string, unknown>;
  const snap = (invoice.snapshotData && typeof invoice.snapshotData === "object"
    ? invoice.snapshotData
    : null) as Record<string, unknown> | null;
  const storedPdfPath =
    (typeof invoiceRecord.pdfUrl === "string" && invoiceRecord.pdfUrl.trim()) ||
    (typeof snap?.pdfUrl === "string" && snap.pdfUrl.trim()) ||
    (typeof snap?.pdfFilePath === "string" && snap.pdfFilePath.trim()) ||
    null;

  if (storedPdfPath) {
    const fileCheck = defaultFileVerifier(storedPdfPath);
    if (!fileCheck.exists || !fileCheck.buffer || !fileCheck.sha256) {
      // Fail closed: Never fall back to live rebuild when a stored original PDF is designated
      return new NextResponse(
        "Das hinterlegte historische Rechnungsdokument ist nicht verfügbar oder beschädigt.",
        { status: 422 }
      );
    }

    await audit({
      userId: user.id,
      action: "invoice.pdf",
      entity: "Invoice",
      entityId: invoice.id,
      metadata: { source: "stored_historical_file", sha256: fileCheck.sha256 },
    });

    const isDownload = url.searchParams.get("download") === "true";
    const disposition = isDownload ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(fileCheck.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="Rechnung-${invoice.invoiceNumber}.pdf"`,
        "X-Document-Source": "stored_historical_file",
        "X-Document-Checksum": fileCheck.sha256,
        "Cache-Control": "no-store",
      },
    });
  }

  // Non-V2 without stored original file: check if there are frozen snapshot items
  const hasFrozenSnapshot =
    (snap && Array.isArray(snap.items) && snap.items.length > 0) ||
    (snap && Array.isArray(snap.pdfItems) && snap.pdfItems.length > 0);

  const documentSourceHeader = hasFrozenSnapshot ? "frozen_snapshot" : "live_generation";

  try {
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
        "X-Document-Source": documentSourceHeader,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(msg, { status: 422 });
  }
}
