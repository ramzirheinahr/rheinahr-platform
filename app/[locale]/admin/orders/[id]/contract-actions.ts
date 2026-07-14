"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";

export async function deleteContract(contractId: string) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    include: { assignments: true },
  });

  if (!contract) {
    throw new Error("Vertrag nicht gefunden.");
  }

  // Release the assignments (the contractId will become null)
  await prisma.$transaction([
    prisma.assignment.updateMany({
      where: { contractId },
      data: { contractId: null },
    }),
    prisma.clientContract.delete({
      where: { id: contractId },
    }),
  ]);

  await audit({
    userId: user.id,
    action: "contract.delete",
    entity: "ClientContract",
    entityId: contractId,
    metadata: { assignmentCount: contract.assignments.length }
  });

  revalidatePath("/", "layout");
}

export async function generateOrderContracts(assignmentIds: string[]) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");

  if (!assignmentIds || assignmentIds.length === 0) {
    throw new Error("Keine Schichten ausgewählt.");
  }

  // Find all uncontracted shifts in this order that were selected
  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      contractId: null,
      status: "confirmed"
    },
    select: { 
      id: true,
      worker: { select: { fullName: true, qualification: true } },
      order: { 
        select: { 
          shiftDate: true, 
          startTime: true, 
          endTime: true, 
          notes: true, 
          requiredQualification: true,
          clientId: true,
          requestGroupId: true,
          client: { select: { facilityName: true, userId: true } } 
        } 
      }
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (!assignments.length) {
    throw new Error("Die ausgewählten Schichten sind ungültig oder bereits unter Vertrag.");
  }

  // Verify all assignments belong to the same client
  const clientId = assignments[0].order.clientId;
  if (assignments.some(a => a.order.clientId !== clientId)) {
    throw new Error("Alle ausgewählten Schichten müssen zum selben Kunden gehören.");
  }

  const clientUserId = assignments[0].order.client.userId;
  const requestGroupId = assignments[0].order.requestGroupId;
  const firstDate = assignments[0].order.shiftDate;
  const lastDate = assignments[assignments.length - 1].order.shiftDate;
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC" }).format(d);
  
  let periodLabel = formatDate(firstDate);
  if (firstDate.getTime() !== lastDate.getTime()) {
    periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
  }

  // Create contract
  const contract = await prisma.clientContract.create({
    data: {
      clientId,
      period: periodLabel,
      status: "pending",
      assignments: {
        connect: assignments.map(a => ({ id: a.id }))
      }
    },
    include: { client: true }
  });

  await prisma.notification.create({
    data: {
      userId: clientUserId,
      type: "contract_pending",
      channel: "in_app",
      content: `Ein neuer AÜV für die الطلبية ${periodLabel} steht zur Signatur bereit.`,
      link: `/client/orders/${requestGroupId}`
    }
  });

  const contractHtml = `
    <p>Ein neuer Arbeitnehmerüberlassungsvertrag (AÜV) für <strong>${periodLabel}</strong> wurde erstellt und steht zur Signatur bereit.</p>
    <p>Folgende Einsätze sind Bestandteil dieses Vertrags:</p>
    ${buildShiftHtmlTable(assignments.map(a => ({
      date: a.order.shiftDate,
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      qualification: a.worker.qualification,
      notes: a.order.notes || undefined,
      facilityName: a.order.client.facilityName,
      workerName: a.worker.fullName,
    })))}
    <p>Bitte prüfen und unterzeichnen Sie den Vertrag in Ihrem Kundenportal.</p>
  `;

  await pushToUsers([clientUserId], {
    title: "Neuer Vertrag zur Signatur",
    body: `Ein neuer AÜV für die Bestellung (${periodLabel}) steht zur Signatur bereit.`,
    url: `/client/orders/${requestGroupId}`,
    htmlBody: contractHtml,
  });

  await audit({
    userId: user.id,
    action: "contract.generate",
    entity: "ClientContract",
    entityId: contract.id,
    metadata: { assignmentCount: assignments.length, period: periodLabel }
  });

  revalidatePath("/", "layout");
  return { ok: true, contractId: contract.id };
}

export async function uploadSignedContract(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) return { ok: false, error: "forbidden" };

  const contractId = formData.get("contractId") as string;
  const file = formData.get("document") as File | null;

  if (!contractId || !file || file.size === 0) {
    return { ok: false, error: "invalid_input" };
  }

  const contract = await prisma.clientContract.findUnique({
    where: { id: contractId },
    select: { id: true }
  });

  if (!contract) {
    return { ok: false, error: "not_found" };
  }

  const path = `contracts/${contractId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("confirmations")
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    console.error("Supabase upload error:", error);
    return { ok: false, error: "saveError" };
  }

  const { headers } = await import("next/headers");
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || "unknown";

  await prisma.clientContract.update({
    where: { id: contractId },
    data: {
      status: "signed",
      documentUrl: path,
      signedAt: new Date(),
      ipAddress: ip,
    }
  });

  await audit({
    userId: user.id,
    action: "contract.signed_upload",
    entity: "ClientContract",
    entityId: contractId,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
