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
    return; // Contract already deleted or not found, silently succeed
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

export async function generateOrderContracts(assignmentIds: string[], splitByShift?: boolean) {
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
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
  
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
      splitByShift: splitByShift || false,
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

export async function createContractUploadTicket({
  fileName,
  fileSize,
}: {
  fileName: string;
  fileSize: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }
  if (!fileSize || fileSize <= 0) {
    return { ok: false, error: "Bitte eine Datei auswählen." };
  }
  if (fileSize > 25 * 1024 * 1024) {
    return { ok: false, error: "Datei ist zu groß (max. 25 MB)." };
  }

  const cleanFilename = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `contracts/${Date.now()}-${cleanFilename}`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from("confirmations")
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("Failed to create signed upload url for contract:", error);
    return { ok: false, error: "Fehler beim Vorbereiten des Uploads." };
  }

  return { ok: true, path: data.path, token: data.token };
}

export async function finalizeDirectSignedContract({
  assignmentIds,
  path,
}: {
  assignmentIds: string[];
  path: string;
}): Promise<{ ok: boolean; contractId?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) return { ok: false, error: "forbidden" };

  if (!assignmentIds.length) {
    return { ok: false, error: "Keine Schichten ausgewählt." };
  }

  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      contractId: null,
      status: "confirmed"
    },
    select: { 
      id: true,
      order: { 
        select: { 
          shiftDate: true,
          clientId: true,
        } 
      }
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (!assignments.length) {
    return { ok: false, error: "Keine passenden Schichten gefunden." };
  }

  const clientId = assignments[0].order.clientId;
  if (assignments.some(a => a.order.clientId !== clientId)) {
    return { ok: false, error: "Schichten gehören zu verschiedenen Kunden." };
  }

  const firstDate = assignments[0].order.shiftDate;
  const lastDate = assignments[assignments.length - 1].order.shiftDate;
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
  
  let periodLabel = formatDate(firstDate);
  if (firstDate.getTime() !== lastDate.getTime()) {
    periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
  }

  const { headers } = await import("next/headers");
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || "unknown";

  const contract = await prisma.clientContract.create({
    data: {
      clientId,
      period: periodLabel,
      status: "signed",
      splitByShift: false,
      documentUrl: path,
      signedAt: new Date(),
      ipAddress: ip,
      assignments: {
        connect: assignments.map(a => ({ id: a.id }))
      }
    }
  });

  await audit({
    userId: user.id,
    action: "contract.direct_signed_upload",
    entity: "ClientContract",
    entityId: contract.id,
    metadata: { assignmentCount: assignments.length, period: periodLabel }
  });

  revalidatePath("/", "layout");
  return { ok: true, contractId: contract.id };
}

export async function uploadDirectSignedContract(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) return { ok: false, error: "forbidden" };

  const assignmentIdsStr = formData.get("assignmentIds") as string;
  const file = formData.get("document") as File | null;

  if (!assignmentIdsStr || !file || file.size === 0) {
    return { ok: false, error: "invalid_input" };
  }

  let assignmentIds: string[];
  try {
    assignmentIds = JSON.parse(assignmentIdsStr);
  } catch {
    return { ok: false, error: "invalid_input" };
  }

  if (assignmentIds.length === 0) {
    return { ok: false, error: "invalid_input" };
  }

  // Verify assignments
  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
      contractId: null,
      status: "confirmed"
    },
    select: { 
      id: true,
      order: { 
        select: { 
          shiftDate: true,
          clientId: true,
        } 
      }
    },
    orderBy: { order: { shiftDate: "asc" } }
  });

  if (!assignments.length) {
    return { ok: false, error: "invalid_assignments" };
  }

  const clientId = assignments[0].order.clientId;
  if (assignments.some(a => a.order.clientId !== clientId)) {
    return { ok: false, error: "mixed_clients" };
  }

  const firstDate = assignments[0].order.shiftDate;
  const lastDate = assignments[assignments.length - 1].order.shiftDate;
  
  const formatDate = (d: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin" }).format(d);
  
  let periodLabel = formatDate(firstDate);
  if (firstDate.getTime() !== lastDate.getTime()) {
    periodLabel = `${formatDate(firstDate)} – ${formatDate(lastDate)}`;
  }

  // Create a contract with status signed
  const contract = await prisma.clientContract.create({
    data: {
      clientId,
      period: periodLabel,
      status: "signed",
      splitByShift: false, // Since it's manually signed, it's one document
      assignments: {
        connect: assignments.map(a => ({ id: a.id }))
      }
    }
  });

  // Upload file
  const path = `contracts/${contract.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  let contentType = file.type?.toLowerCase().split(";")[0]?.trim();
  if (!contentType || contentType === "application/octet-stream") {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") contentType = "application/pdf";
    else if (ext === "png") contentType = "image/png";
    else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
    else if (ext === "webp") contentType = "image/webp";
  }
  if (contentType === "image/jpg") contentType = "image/jpeg";
  if (!contentType) contentType = "application/pdf";

  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { error: uploadError } = await supabase.storage
    .from("confirmations")
    .upload(path, await file.arrayBuffer(), {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    console.error("Supabase upload error:", uploadError);
    // Cleanup contract if upload failed
    await prisma.clientContract.delete({ where: { id: contract.id } });
    return { ok: false, error: `Upload-Fehler: ${uploadError.message}` };
  }

  const { headers } = await import("next/headers");
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || "unknown";

  // Update contract with document URL
  await prisma.clientContract.update({
    where: { id: contract.id },
    data: {
      documentUrl: path,
      signedAt: new Date(),
      ipAddress: ip,
    }
  });

  await audit({
    userId: user.id,
    action: "contract.direct_signed_upload",
    entity: "ClientContract",
    entityId: contract.id,
    metadata: { assignmentCount: assignments.length, period: periodLabel }
  });

  revalidatePath("/", "layout");
  return { ok: true, contractId: contract.id };
}

