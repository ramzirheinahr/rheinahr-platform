"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { workerShiftLink, orderLink, buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { formatDateDE } from "@/lib/utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok: boolean; error?: string; documentUrl?: string };

const BUCKET = "confirmations";

const publicConfirmationSchema = z.object({
  requestGroupId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  signerName: z.string().trim().min(1),
  signatureData: z.string().min(1),
  hoursWorked: z.coerce.number().min(0).max(24),
});

export async function confirmServicePublic(
  input: z.infer<typeof publicConfirmationSchema>
): Promise<ActionState> {
  const parsed = publicConfirmationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  // Validate the assignment belongs to the requestGroupId and is ready for confirmation
  const assignment = await prisma.assignment.findUnique({
    where: { id: data.assignmentId },
    include: {
      serviceConfirmation: { select: { id: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { id: true, facilityName: true, userId: true } },
        },
      },
      worker: { select: { userId: true, fullName: true, qualification: true } },
    },
  });

  if (!assignment) return { ok: false, error: "notFound" };
  if (assignment.order.requestGroupId !== data.requestGroupId) return { ok: false, error: "forbidden" };
  if (assignment.status !== "confirmed") return { ok: false, error: "forbidden" };
  if (assignment.serviceConfirmation) return { ok: false, error: "alreadyConfirmed" };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const [{ renderLeistungsnachweisPdf }, { qualLabel, methodLabel }] = await Promise.all([
    import("@/lib/pdf/leistungsnachweis"),
    import("@/lib/invoicing"),
  ]);

  const pdf = await renderLeistungsnachweisPdf({
    facilityName: assignment.order.client.facilityName,
    workerName: assignment.worker.fullName,
    qualificationLabel: qualLabel[assignment.worker.qualification],
    shiftDate: assignment.order.shiftDate.toISOString().slice(0, 10),
    startTime: assignment.order.startTime,
    endTime: assignment.order.endTime,
    hours: data.hoursWorked,
    methodLabel: methodLabel.electronic,
    isElectronic: true,
    signatureData: data.signatureData,
    signerName: data.signerName,
    confirmedByEmail: "Öffentlicher Link (Kunde)",
    confirmedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    ipAddress: ip,
    orderId: assignment.order.id,
    assignmentId: data.assignmentId,
    draft: false,
  });

  const path = `${data.assignmentId}/signed/leistungsnachweis-${Date.now()}.pdf`;
  const supabase = createSupabaseAdminClient();
  
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Uint8Array(pdf), {
      contentType: "application/pdf",
      upsert: false,
    });
    
  if (uploadError) return { ok: false, error: "saveError" };

  // Create temporary download URL (valid for 1 hour)
  const { data: urlData, error: urlError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (urlError) return { ok: false, error: "saveError" };

  await prisma.$transaction(async (tx) => {
    await tx.serviceConfirmation.create({
      data: {
        assignmentId: data.assignmentId,
        confirmedById: null, // Public confirm has no user
        method: "electronic",
        signatureData: data.signatureData,
        documentUrl: path,
        hoursWorked: data.hoursWorked,
        clientNotes: "Bestätigt über öffentlichen Link",
        ipAddress: ip,
        requestedStart: null,
        requestedEnd: null,
      },
    });

    const remaining = await tx.assignment.count({
      where: {
        orderId: assignment.order.id,
        status: "confirmed",
        serviceConfirmation: { is: null },
      },
    });
    if (remaining === 0) {
      await tx.order.update({
        where: { id: assignment.order.id },
        data: { status: "confirmed" },
      });
    }

    const recipients = await tx.user.findMany({
      where: {
        OR: [
          { id: assignment.worker.userId },
          { role: { in: ["admin", "super_admin"] }, active: true },
        ],
      },
      select: { id: true, role: true },
    });
    const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
    if (recipients.length) {
      await tx.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          type: "service_confirmed" as const,
          channel: "in_app" as const,
          content: `${assignment.order.client.facilityName} · ${formatDateDE(assignment.order.shiftDate)} · ${data.hoursWorked} Std. (Öffentlicher Link)`,
          link: r.role === "worker" ? workerShiftLink() : orderLink(r.role, reqGroup),
        })),
      });
    }
  });

  await audit({
    userId: assignment.order.client.userId || "system", // Use client user ID for tracing, or fallback
    action: "service.confirm",
    entity: "Assignment",
    entityId: data.assignmentId,
    ipAddress: ip,
    metadata: {
      method: "electronic",
      hours: data.hoursWorked,
      actorRole: "public_client",
      signerName: data.signerName,
    },
  });

  const confirmBody = `${assignment.order.client.facilityName} · ${formatDateDE(assignment.order.shiftDate)} · ${data.hoursWorked} Std.`;
  const confirmGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const pushAdmins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  const confirmHtml = `
    <p>Die Leistung für den folgenden Einsatz wurde (über den öffentlichen Link) bestätigt:</p>
    ${buildShiftHtmlTable([{
      date: assignment.order.shiftDate,
      startTime: assignment.order.startTime,
      endTime: assignment.order.endTime,
      qualification: assignment.worker.qualification,
      facilityName: assignment.order.client.facilityName,
      workerName: assignment.worker.fullName,
    }])}
    <p><strong>Bestätigte Stunden:</strong> ${data.hoursWorked} Std.</p>
    <p><strong>Unterzeichner:</strong> ${data.signerName}</p>
  `;

  await Promise.all([
    pushToUsers([assignment.worker.userId], {
      title: "Leistung bestätigt",
      body: confirmBody,
      url: workerShiftLink(),
      htmlBody: confirmHtml,
    }),
    pushToUsers(
      pushAdmins.map((a) => a.id),
      { title: "Leistung bestätigt (Public)", body: confirmBody, url: orderLink("admin", confirmGroup), htmlBody: confirmHtml },
    ),
  ]);

  revalidatePath(`/public/confirm/${data.requestGroupId}`);
  if (assignment.order.client.userId) {
    revalidatePath("/client/orders");
    revalidatePath(`/client/orders/${assignment.order.requestGroupId}`);
  }
  revalidatePath(`/admin/orders/${assignment.order.requestGroupId}`);

  return { ok: true, documentUrl: urlData.signedUrl };
}
