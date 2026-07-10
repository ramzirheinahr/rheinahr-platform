import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { qualLabel } from "@/lib/invoicing";
import { renderContractPdf } from "@/lib/pdf/contract";
import { format } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ contractId: string }> }) {
  const params = await props.params;
  const { contractId } = params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
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

  if (!contract) return new NextResponse("Not found", { status: 404 });

  const allowed = roleSatisfies(user.role, ["admin"]) || contract.client.userId === user.id;
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Map data to PDF template props
  const pdfData = {
    facilityName: contract.client.facilityName,
    facilityAddress: contract.client.address || "Adresse unbekannt",
    period: contract.period || "angegeben",
    status: contract.status,
    signatureData: contract.signatureData,
    signedAt: contract.signedAt ? format(contract.signedAt, "dd.MM.yyyy HH:mm") : undefined,
    ipAddress: contract.ipAddress,
    assignments: contract.assignments.map(a => ({
      workerName: a.worker.fullName,
      qualification: qualLabel[a.order.requiredQualification] || a.order.requiredQualification,
      shiftDate: format(a.order.shiftDate, "dd.MM.yyyy"),
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      socialSecurity: a.worker.socialSecurityNumber || ""
    }))
  };

  const pdfBuffer = await renderContractPdf(pdfData);

  // If we wanted to archive it to Supabase Storage like Leistungsnachweis we would do it on signing.
  // For now, we generate it dynamically on request.

  await audit({
    userId: user.id,
    action: "contract.pdf",
    entity: "ClientContract",
    entityId: contract.id
  });

  const url = new URL(_req.url);
  const isDownload = url.searchParams.get("download") === "true";
  const disposition = isDownload ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="AUEG-Vertrag-${contract.client.facilityName.replace(/\s+/g, "_")}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
