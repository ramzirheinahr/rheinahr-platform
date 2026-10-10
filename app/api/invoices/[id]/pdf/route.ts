import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";
import { hasReliableInvoiceDocument } from "@/lib/invoicing";

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let revSnapshot: any = null;
    let revNet = invoice.netAmount;
    let revVat = invoice.vatAmount;
    let revGross = invoice.grossAmount;
    let auditEntityId = invoice.id;

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
      revSnapshot = prevProvenance?.rawSnapshotData || prevProvenance;
      revNet = rev1.previousNetAmount;
      revVat = rev1.previousVatAmount;
      revGross = rev1.previousGrossAmount;
      auditEntityId = rev1.id;
    } else {
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

      revSnapshot = revision.newSnapshotData;
      revNet = revision.newNetAmount;
      revVat = revision.newVatAmount;
      revGross = revision.newGrossAmount;
      auditEntityId = revision.id;
    }

    if (!revSnapshot || typeof revSnapshot !== "object") {
      return new NextResponse("Keine verlässlichen Snapshot-Daten für diese Revision hinterlegt", {
        status: 422,
      });
    }

    const dummyClient = {
      id: invoice.client.id,
      shortCode: invoice.client.shortCode,
      internalNumber: invoice.client.internalNumber,
      facilityName: invoice.client.facilityName,
      address: invoice.client.address,
      billingEmail: invoice.client.billingEmail,
      billingInfo: invoice.client.billingInfo,
      paymentTermsDays: invoice.client.paymentTermsDays,
    };

    const invoiceForRevision = {
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      netAmount: revNet,
      vatAmount: revVat,
      grossAmount: revGross,
      snapshotData: revSnapshot,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfData = buildInvoicePdfData(invoiceForRevision as any, dummyClient as any, []);
    const pdfBuffer = await generateInvoicePdf(pdfData);

    await audit({
      userId: user.id,
      action: "invoice.pdf_revision",
      entity: "InvoiceRevision",
      entityId: auditEntityId,
      metadata: { invoiceId: id, revisionNumber },
    });

    const isDownload = url.searchParams.get("download") === "true";
    const disposition = isDownload ? "attachment" : "inline";

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="Rechnung-${invoice.invoiceNumber}-Rev${revisionNumber}.pdf"`,
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
