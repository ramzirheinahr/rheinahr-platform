"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { pushToUsers } from "@/lib/push";
import { renderContractPdf } from "@/lib/pdf/contract";
import { resolveRates, resolveSurcharges, resolveNightWindow, requestNetTotal, rateFor } from "@/lib/pricing";
import { qualLabel } from "@/lib/invoicing";
import { format } from "date-fns";

export async function signContractPublic({
  requestGroupId,
  contractId,
  signerName,
  signatureData,
}: {
  requestGroupId: string;
  contractId: string;
  signerName: string;
  signatureData: string;
}) {
  if (!signerName?.trim()) {
    return { ok: false, error: "nameRequired" };
  }

  // Find the contract and verify it belongs to this requestGroupId
  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    include: {
      client: true,
      assignments: {
        include: { worker: true, order: true },
        orderBy: { order: { shiftDate: "asc" } }
      }
    }
  });

  if (!contract || contract.status !== "pending") {
    return { ok: false, error: "invalid_contract" };
  }

  const belongsToGroup = contract.assignments.some(a => a.order.requestGroupId === requestGroupId);
  if (!belongsToGroup) {
    return { ok: false, error: "forbidden" };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const signedAtDate = new Date();
  const signedAtFormatted = format(signedAtDate, "dd.MM.yyyy HH:mm");

  // Map data to PDF template props
  const rates = resolveRates(contract.client);
  const surcharges = resolveSurcharges(contract.client);
  const nightWindow = resolveNightWindow(contract.client);

  const pdfData = {
    facilityName: contract.client.facilityName,
    facilityAddress: contract.client.address || "Adresse unbekannt",
    period: contract.period || "angegeben",
    status: "signed",
    signatureData,
    signedAt: signedAtFormatted,
    ipAddress: ip,
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

  const pdfBuffer = await renderContractPdf(pdfData);

  const path = `contracts/${contractId}/${Date.now()}-AUEG-Vertrag.pdf`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("confirmations")
    .upload(path, new Uint8Array(pdfBuffer), {
      contentType: "application/pdf",
      upsert: false,
    });
    
  if (error) return { ok: false, error: "saveError" };

  await prisma.clientContract.update({
    where: { id: contractId },
    data: {
      status: "signed",
      documentUrl: path,
      signedAt: signedAtDate,
      signatureData: signatureData,
      ipAddress: ip,
    }
  });

  await audit({
    userId: null,
    action: "contract.sign_public",
    entity: "ClientContract",
    entityId: contractId,
    ipAddress: ip,
    metadata: { signerName }
  });

  // Notify admins
  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true }
  });

  if (admins.length > 0) {
    const title = "Vertrag signiert";
    const body = `Der AÜV für ${contract.client.facilityName} (${contract.period}) wurde elektronisch signiert.`;
    const link = `/admin/orders/${requestGroupId}`;
    
    await prisma.notification.createMany({
      data: admins.map(a => ({
        userId: a.id,
        type: "contract_signed",
        channel: "in_app",
        content: body,
        link
      }))
    });

    await pushToUsers(
      admins.map(a => a.id),
      { title, body, url: link }
    );
  }

  revalidatePath("/");
  
  return { ok: true };
}
