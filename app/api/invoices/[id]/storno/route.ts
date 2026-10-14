import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getCompanyConfig, type CompanyConfig } from "@/lib/config/company";
import { buildStornoInvoiceData } from "@/lib/storno-invoice";
import { generateInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StornoDocument = {
  version: 1;
  issuedAt: string;
  data: InvoicePdfData;
  companyConfig: CompanyConfig;
};

function storedDocument(snapshotData: unknown): StornoDocument | null {
  if (!snapshotData || typeof snapshotData !== "object" || Array.isArray(snapshotData)) return null;
  const document = (snapshotData as Record<string, unknown>).stornoDocument;
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  const d = document as Record<string, unknown>;
  if (d.version !== 1 || typeof d.issuedAt !== "string" ||
      !d.data || typeof d.data !== "object" || !d.companyConfig || typeof d.companyConfig !== "object") return null;
  return document as StornoDocument;
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await props.params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { client: { select: { userId: true } } },
  });
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  if (!roleSatisfies(user.role, ["admin"]) && invoice.client.userId !== user.id) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (invoice.status !== "cancelled") return new NextResponse("Not cancelled", { status: 409 });
  const document = storedDocument(invoice.snapshotData);
  if (!document || document.data.cancellation?.originalInvoiceNumber !== invoice.invoiceNumber) {
    return new NextResponse("Stornorechnung noch nicht erstellt. Bitte zuerst im Bereich Stornierte Rechnungen erstellen.", { status: 404 });
  }
  try {
    const pdfBuffer = await generateInvoicePdf(document.data, document.companyConfig);
    await audit({
      userId: user.id,
      action: "invoice.storno_pdf",
      entity: "Invoice",
      entityId: invoice.id,
      metadata: { stornoNumber: document.data.invoiceNumber, originalInvoiceNumber: invoice.invoiceNumber },
    });
    const isDownload = new URL(req.url).searchParams.get("download") === "true";
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="Stornorechnung-${document.data.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Stornorechnung konnte nicht gerendert werden.", { status: 422 });
  }
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!roleSatisfies(user.role, ["admin"])) return new NextResponse("Forbidden", { status: 403 });
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin) return new NextResponse("Forbidden origin", { status: 403 });
  const { id } = await props.params;
  const companyConfig = await getCompanyConfig();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "invoices" WHERE id = ${id} FOR UPDATE`);
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new Error("Rechnung nicht gefunden.");
      if (invoice.status !== "cancelled") throw new Error("Rechnung ist nicht storniert.");
      if (storedDocument(invoice.snapshotData)) return;
      const issuedAt = new Date();
      const data = buildStornoInvoiceData(invoice, issuedAt);
      const snapshot = invoice.snapshotData as Record<string, unknown>;
      await tx.invoice.update({
        where: { id },
        data: { snapshotData: {
          ...snapshot,
          stornoDocument: { version: 1, issuedAt: issuedAt.toISOString(), data, companyConfig },
        } as Prisma.InputJsonValue },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "invoice.storno_issue",
          entity: "Invoice",
          entityId: id,
          metadata: { stornoNumber: data.invoiceNumber, originalInvoiceNumber: invoice.invoiceNumber },
        },
      });
    });
    return NextResponse.json({ ok: true, url: `/api/invoices/${id}/storno` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stornorechnung konnte nicht erstellt werden.";
    return new NextResponse(message, { status: 422 });
  }
}
