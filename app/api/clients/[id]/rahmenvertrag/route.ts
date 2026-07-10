import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resolveRates, resolveSurcharges } from "@/lib/pricing";
import { renderRahmenvertragPdf, RahmenvertragData } from "@/lib/pdf/rahmenvertrag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const client = await prisma.client.findUnique({
    where: { id: params.id }
  });

  if (!client) return new NextResponse("Not found", { status: 404 });

  const pdfData: RahmenvertragData = {
    facilityName: client.facilityName,
    facilityAddress: client.address || "Adresse unbekannt",
    createdAt: new Date(),
    rates: resolveRates(client),
    surcharges: resolveSurcharges(client),
  };

  const pdfBuffer = await renderRahmenvertragPdf(pdfData);

  await audit({
    userId: user.id,
    action: "client.rahmenvertrag.generate",
    entity: "Client",
    entityId: client.id
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Rahmenvertrag-${client.facilityName.replace(/\s+/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
