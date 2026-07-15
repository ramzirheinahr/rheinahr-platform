import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { qualLabel } from "@/lib/invoicing";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal, rateFor } from "@/lib/pricing";
import { renderContractPdf } from "@/lib/pdf/contract";
import { format } from "date-fns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ contractId: string }> }) {
  const params = await props.params;
  const { contractId } = params;
  const url = new URL(_req.url);
  const requestGroupIdParam = url.searchParams.get("requestGroupId");

  const user = await getCurrentUser();
  if (!user && !requestGroupIdParam) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    include: {
      client: true,
      assignments: {
        include: {
          worker: true,
          order: {
            select: {
              shiftDate: true,
              startTime: true,
              endTime: true,
              breakMinutes: true,
              requiredQualification: true,
              requestGroupId: true
            }
          }
        },
        orderBy: { order: { shiftDate: "asc" } }
      }
    }
  });

  if (!contract) return new NextResponse("Not found", { status: 404 });

  let allowed = false;
  if (user) {
    allowed = roleSatisfies(user.role, ["admin"]) || contract.client.userId === user.id;
  } else if (requestGroupIdParam) {
    allowed = contract.assignments.some(a => a.order.requestGroupId === requestGroupIdParam);
  }
  
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  // Map data to PDF template props
  const rates = resolveRates(contract.client);
  const surcharges = resolveSurcharges(contract.client);
  const nightWindow = resolveNightWindow(contract.client);

  const pdfData = {
    facilityName: contract.client.facilityName,
    facilityAddress: contract.client.address || "Adresse unbekannt",
    period: contract.period || "angegeben",
    status: contract.status,
    signatureData: contract.signatureData,
    signedAt: contract.signedAt ? format(contract.signedAt, "dd.MM.yyyy HH:mm") : undefined,
    ipAddress: contract.ipAddress,
    assignments: contract.assignments.map(a => {
      const baseRate = rateFor(a.order.requiredQualification, rates);
      const amount = requestNetTotal(
        [{
          shiftDate: a.order.shiftDate,
          startTime: a.order.startTime,
          endTime: a.order.endTime,
          breakMinutes: a.order.breakMinutes || 30,
          quantity: 1,
          requiredQualification: a.order.requiredQualification,
        }],
        surcharges,
        rates,
        nightWindow
      );

      return {
        workerName: a.worker.fullName,
        qualification: qualLabel[a.order.requiredQualification] || a.order.requiredQualification,
        shiftDate: format(a.order.shiftDate, "dd.MM.yyyy"),
        startTime: a.order.startTime,
        endTime: a.order.endTime,
        socialSecurity: a.worker.socialSecurityNumber || "",
        hourlyRate: baseRate,
        totalAmount: amount
      };
    })
  };

  // If the contract is signed and has a document URL, serve it instead of rendering a new one.
  if (contract.documentUrl && contract.status === "signed") {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from("confirmations")
      .download(contract.documentUrl);
    if (!error && data) {
      await audit({
        userId: user?.id,
        action: "contract.pdf_download_signed",
        entity: "ClientContract",
        entityId: contract.id,
        ipAddress: requestGroupIdParam ? "public_link" : undefined
      });
      const isDownload = url.searchParams.get("download") === "true";
      const disposition = isDownload ? "attachment" : "inline";
      return new NextResponse(new Uint8Array(await data.arrayBuffer()), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposition}; filename="AUEG-Vertrag-${contract.client.facilityName.replace(/\s+/g, "_")}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }
    // Fallback to rendering dynamically if file is missing
  }

  const pdfBuffer = await renderContractPdf(pdfData);

  await audit({
    userId: user?.id,
    action: "contract.pdf",
    entity: "ClientContract",
    entityId: contract.id,
    ipAddress: requestGroupIdParam ? "public_link" : undefined
  });

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
