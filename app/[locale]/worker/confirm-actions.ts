"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { workerShiftLink, orderLink, buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import { formatDateDE, formatDateTimeDE } from "@/lib/utils";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ActionState = { ok: boolean; error?: string; documentUrl?: string };

const BUCKET = "confirmations";

const workerConfirmationSchema = z.object({
  assignmentId: z.string().uuid(),
  signerName: z.string().trim().min(1),
  signatureData: z.string().min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  breakMinutes: z.coerce.number().min(0).max(600),
  clientNotes: z.string().optional(),
});

export async function confirmServiceByWorkerOnDevice(
  input: z.infer<typeof workerConfirmationSchema>
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") {
    return { ok: false, error: "forbidden" };
  }

  const parsed = workerConfirmationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  // Validate the assignment belongs to the worker and is ready for confirmation
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
          breakMinutes: true,
          client: { select: { id: true, facilityName: true, userId: true } },
        },
      },
      worker: { select: { id: true, userId: true, fullName: true, qualification: true } },
    },
  });

  if (!assignment) return { ok: false, error: "notFound" };
  // Only the assigned worker can do this
  if (assignment.worker.userId !== user.id) return { ok: false, error: "forbidden" };
  // Only confirmed assignments can be service-confirmed
  if (assignment.status !== "confirmed") return { ok: false, error: "forbidden" };
  if (assignment.serviceConfirmation) return { ok: false, error: "alreadyConfirmed" };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const [{ renderLeistungsnachweisPdf }, { qualLabel, methodLabel }] = await Promise.all([
    import("@/lib/pdf/leistungsnachweis"),
    import("@/lib/invoicing"),
  ]);

  const timeModified =
    data.startTime !== assignment.order.startTime ||
    data.endTime !== assignment.order.endTime ||
    data.breakMinutes !== (assignment.order.breakMinutes ?? 30);

  // If time was modified by agreement, update the Order in DB
  if (timeModified) {
    await prisma.order.update({
      where: { id: assignment.order.id },
      data: {
        startTime: data.startTime,
        endTime: data.endTime,
        breakMinutes: data.breakMinutes,
      },
    });
  }

  // Calculate the hours based on the finalized times
  const { netShiftHours } = await import("@/lib/pricing");
  const finalizedHours = netShiftHours(
    timeModified ? data.startTime : assignment.order.startTime,
    timeModified ? data.endTime : assignment.order.endTime,
    timeModified ? data.breakMinutes : assignment.order.breakMinutes
  );

  const documentData = {
    facilityName: assignment.order.client.facilityName,
    workerName: assignment.worker.fullName,
    qualificationLabel: qualLabel[assignment.worker.qualification as keyof typeof qualLabel] || assignment.worker.qualification,
    shiftDate: assignment.order.shiftDate.toISOString().slice(0, 10),
    startTime: timeModified ? data.startTime : assignment.order.startTime,
    endTime: timeModified ? data.endTime : assignment.order.endTime,
    hours: finalizedHours,
    methodLabel: methodLabel.electronic,
    isElectronic: true,
    signatureData: data.signatureData,
    signerName: data.signerName,
    confirmedByEmail: data.signerName,
    confirmedAt: formatDateTimeDE(new Date()),
    ipAddress: null,
    orderId: assignment.order.id,
    assignmentId: data.assignmentId,
    draft: false,
  };

  const pdf = await renderLeistungsnachweisPdf(documentData);

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

  const emails: any[] = [];
  const htmlBody = `
    <p><strong>Datum:</strong> ${formatDateDE(assignment.order.shiftDate)}</p>
    <p><strong>Zeit:</strong> ${timeModified ? data.startTime : assignment.order.startTime} - ${timeModified ? data.endTime : assignment.order.endTime} Uhr (${finalizedHours} Std.)</p>
    <p><strong>Unterzeichner:</strong> ${data.signerName}</p>
  `;

  await prisma.$transaction(async (tx) => {
    await tx.serviceConfirmation.create({
      data: {
        assignmentId: data.assignmentId,
        confirmedById: null, 
        method: "electronic",
        signatureData: data.signatureData,
        documentUrl: path,
        hoursWorked: finalizedHours,
        clientNotes: data.clientNotes || "Bestätigt durch Einrichtungspersonal auf Mitarbeiter-Gerät",
        ipAddress: ip,
        signerName: data.signerName,
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

    const admins = await tx.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, active: true },
      select: { id: true, role: true, email: true },
    });
    
    for (const a of admins) {
      emails.push({
        to: a.email,
        subject: `Schicht bestätigt: ${assignment.worker.fullName} am ${assignment.order.shiftDate.toISOString().slice(0, 10)}`,
        html: `
          <p>Hallo Admin,</p>
          <p>Ein Leistungsnachweis wurde direkt über das Gerät des Mitarbeiters elektronisch signiert.</p>
          <p><strong>Mitarbeiter:</strong> ${assignment.worker.fullName}</p>
          <p><strong>Einrichtung:</strong> ${assignment.order.client.facilityName}</p>
          ${htmlBody}
          <p><a href="${orderLink(a.role, assignment.order.id)}">Zur Schicht im Admin-Portal</a></p>
        `,
      });
    }
    const clientUser = assignment.order.client.userId ? await tx.user.findUnique({ where: { id: assignment.order.client.userId } }) : null;
    if (clientUser?.email) {
      emails.push({
        to: clientUser.email,
        subject: `Schicht bestätigt: ${assignment.worker.fullName} am ${assignment.order.shiftDate.toISOString().slice(0, 10)}`,
        html: `
          <p>Guten Tag,</p>
          <p>Eine Schicht in Ihrer Einrichtung wurde soeben vor Ort elektronisch von ${data.signerName} abgezeichnet.</p>
          <p><strong>Mitarbeiter:</strong> ${assignment.worker.fullName}</p>
          ${htmlBody}
          <p>Sie finden den Beleg im Kundenportal unter Ihren bestätigten Schichten.</p>
        `,
      });
    }

    // Email to Worker
    const workerUser = await tx.user.findUnique({ where: { id: assignment.worker.userId } });
    if (workerUser?.email) {
      emails.push({
        to: workerUser.email,
        subject: `Deine Schicht wurde bestätigt (${assignment.order.shiftDate.toISOString().slice(0, 10)})`,
        html: `
          <p>Hallo ${assignment.worker.fullName},</p>
          <p>Deine Schicht wurde erfolgreich von der Einrichtung abgezeichnet.</p>
          ${htmlBody}
          <p><a href="${workerShiftLink()}">Zur Schicht im Portal</a></p>
        `,
      });
    }
  });

  if (emails.length > 0) {
    await Promise.all(emails.map((e) => sendEmail(e)));
  }

  await audit({
    userId: user.id, 
    action: "service.confirm_worker_device",
    entity: "Assignment",
    entityId: data.assignmentId,
    ipAddress: ip,
    metadata: {
      method: "electronic",
      hours: finalizedHours,
      actorRole: "worker_device_client_signature",
      signerName: data.signerName,
    },
  });

  const confirmBody = `${assignment.order.client.facilityName} · ${formatDateDE(assignment.order.shiftDate)} · ${finalizedHours} Std.`;
  const confirmGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const pushAdmins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  const confirmHtml = `
    <p>Die Leistung für den folgenden Einsatz wurde vor Ort (vom Personal der Einrichtung auf dem Gerät des Mitarbeiters) bestätigt:</p>
    ${buildShiftHtmlTable([{
      date: assignment.order.shiftDate,
      startTime: assignment.order.startTime,
      endTime: assignment.order.endTime,
      qualification: assignment.worker.qualification,
      facilityName: assignment.order.client.facilityName,
      workerName: assignment.worker.fullName,
    }])}
    <p><strong>Bestätigte Stunden:</strong> ${finalizedHours} Std.</p>
    <p><strong>Unterzeichner:</strong> ${data.signerName}</p>
  `;

  await Promise.all([
    pushToUsers([assignment.worker.userId], {
      title: "Ihre Leistung wurde bestätigt",
      body: confirmBody,
      url: workerShiftLink(),
      htmlBody: confirmHtml,
    }),
    pushToUsers(
      pushAdmins.map((a) => a.id),
      { title: "Leistung bestätigt (Vor Ort)", body: confirmBody, url: orderLink("admin", confirmGroup), htmlBody: confirmHtml },
    ),
  ]);

  revalidatePath("/worker");
  if (assignment.order.client.userId) {
    revalidatePath("/client/orders");
    revalidatePath(`/client/orders/${assignment.order.requestGroupId}`);
  }
  revalidatePath(`/admin/orders/${assignment.order.requestGroupId}`);

  return { ok: true, documentUrl: urlData.signedUrl };
}
