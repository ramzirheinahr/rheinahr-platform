import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateInvoicePdf } from "@/lib/pdf/invoice";
import { buildInvoicePdfData } from "@/lib/invoice-pdf-builder";

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

  const pdfData = buildInvoicePdfData(invoice, invoice.client, invoice.assignments);

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
