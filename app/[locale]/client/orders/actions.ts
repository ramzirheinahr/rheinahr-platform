"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, resolveClientId } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { diffRequestShifts, isRequestEditable, isRequestCancelable } from "@/lib/orders";
import { formatDateDE } from "@/lib/utils";
import { orderRequestSchema, type OrderRequestInput } from "@/lib/validations";
import { orderLink, inboxLink, workerShiftLink, buildShiftHtmlTable } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import type { Qualification } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

const PUSH_TITLE = {
  new_order: "Neue Anfrage",
  order_status_changed: "Anfrage aktualisiert",
  new_message: "Neue Nachricht",
} as const;

async function notifyAdmins(
  type: "new_order" | "order_status_changed" | "new_message",
  content: string,
  link?: string,
  htmlContent?: string,
) {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      type,
      channel: "in_app" as const,
      content,
      link: link ?? null,
    })),
  });
  await pushToUsers(
    admins.map((a) => a.id),
    { title: PUSH_TITLE[type], body: content, url: link, htmlBody: htmlContent },
  );
}

// Edit a request: apply only the actual changes. Allowed until 4h before the
// first shift (see isRequestEditable). Untouched shifts keep their orders and
// assignments — only modified/removed shifts lose theirs — and the admins are
// notified so they can re-process what changed.
export async function updateOrderRequest(
  requestGroupId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const clientId = await resolveClientId(user);
  if (!clientId) return { ok: false, error: "saveError" };
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const existing = await prisma.order.findMany({
    where: { requestGroupId, clientId: client.id },
    select: {
      id: true,
      status: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      breakMinutes: true,
      quantity: true,
      notes: true,
      requiredQualification: true,
    },
  });
  if (existing.length === 0) return { ok: false, error: "forbidden" };
  if (!isRequestEditable(existing)) return { ok: false, error: "locked" };

  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { notes, shifts } = parsed.data;

  const { updates, creates, deleteIds } = diffRequestShifts(
    existing,
    shifts.map((s) => ({
      date: s.date,
      requiredQualification: s.requiredQualification,
      startTime: s.startTime,
      endTime: s.endTime,
      breakMinutes: s.pause,
      quantity: s.quantity,
      notes: s.bereich ?? notes ?? null,
    })),
  );
  const changes = updates.length + creates.length + deleteIds.length;
  if (changes === 0) return { ok: true };

  await prisma.$transaction([
    ...(deleteIds.length
      ? [prisma.order.deleteMany({ where: { id: { in: deleteIds } } })]
      : []),
    ...updates.map((u) =>
      prisma.order.update({
        where: { id: u.id },
        data: { quantity: u.quantity, breakMinutes: u.breakMinutes, notes: u.notes },
      }),
    ),
    ...(creates.length
      ? [
          prisma.order.createMany({
            data: creates.map((s) => ({
              clientId: client.id,
              requestGroupId,
              requiredQualification: s.requiredQualification as Qualification,
              shiftDate: new Date(`${s.date}T00:00:00.000Z`),
              startTime: s.startTime,
              endTime: s.endTime,
              breakMinutes: s.breakMinutes,
              quantity: s.quantity,
              notes: s.notes,
              status: "pending" as const,
            })),
          }),
        ]
      : []),
  ]);

  const shiftsHtml = `
    <p><strong>${client.facilityName}</strong> hat die Anfrage aktualisiert. Folgende Schichten sind nun Teil der Anfrage:</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
      <thead>
        <tr style="background-color: #f3f4f6; text-align: left;">
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Datum</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Zeit</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Qualifikation</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Bereich/Notizen</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Anzahl</th>
        </tr>
      </thead>
      <tbody>
        ${shifts.map(s => `
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${formatDateDE(new Date(s.date))}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.startTime} - ${s.endTime}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.requiredQualification}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.bereich ?? notes ?? '-'}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.quantity}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Changed shifts re-enter the pipeline — tell the admins to re-process.
  await notifyAdmins(
    "order_status_changed",
    `${client.facilityName}: Anfrage geändert – ${changes} Schicht(en) betroffen`,
    orderLink("admin", requestGroupId),
    shiftsHtml
  );

  await audit({
    userId: user.id,
    action: "order.request.update",
    entity: "Order",
    entityId: requestGroupId,
    metadata: {
      updated: updates.length,
      created: creates.length,
      deleted: deleteIds.length,
    },
  });

  revalidatePath("/client/orders");
  revalidatePath(`/client/orders/${requestGroupId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

// Cancel a whole request (all shifts sharing the requestGroupId) — a HARD
// delete on the owner's instruction: the order rows leave the database
// (assignments cascade); nothing stays behind marked "cancelled". Allowed until
// a shift is confirmed / running / completed (isRequestCancelable) or carries a
// signed Leistungsnachweis. The office (admins) is alerted twice: an in-app
// notification AND a message in the request's inbox thread (the thread is keyed
// by requestGroupId, so it survives the delete); affected workers are notified.
export async function cancelOrderRequest(
  requestGroupId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const clientId = await resolveClientId(user);
  if (!clientId) return { ok: false, error: "saveError" };
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const existing = await prisma.order.findMany({
    where: { requestGroupId, clientId: client.id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: { id: true, status: true, shiftDate: true, startTime: true, endTime: true, requiredQualification: true, notes: true, quantity: true },
  });
  if (existing.length === 0) return { ok: false, error: "forbidden" };
  if (!isRequestCancelable(existing)) return { ok: false, error: "locked" };
  // A signed Leistungsnachweis anywhere in the group is a legal record — the
  // rows must not be destroyed.
  const signed = await prisma.serviceConfirmation.count({
    where: { assignment: { order: { requestGroupId, clientId: client.id } } },
  });
  if (signed > 0) return { ok: false, error: "locked" };

  // Workers holding an active invitation/acceptance lose the shift — tell them.
  const affected = await prisma.assignment.findMany({
    where: {
      order: { requestGroupId, clientId: client.id },
      status: { not: "declined" },
    },
    select: { worker: { select: { userId: true } } },
  });
  const workerUserIds = [...new Set(affected.map((a) => a.worker.userId))];

  await prisma.$transaction([
    prisma.order.deleteMany({ where: { requestGroupId, clientId: client.id } }),
    ...workerUserIds.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          type: "order_status_changed",
          channel: "in_app",
          content: `Einsatz gelöscht – ${client.facilityName}`,
          link: workerShiftLink(),
        },
      }),
    ),
  ]);

  const dateLabel = formatDateDE(existing[0].shiftDate);

  const shiftsHtml = `
    <p><strong>${client.facilityName}</strong> hat die folgende Anfrage (bzw. Schichten) storniert und gelöscht:</p>
    ${buildShiftHtmlTable(existing.map(s => ({
      date: s.shiftDate,
      startTime: s.startTime,
      endTime: s.endTime,
      qualification: s.requiredQualification,
      notes: s.notes || undefined,
      quantity: s.quantity,
    })))}
  `;

  if (workerUserIds.length > 0) {
    await pushToUsers(workerUserIds, {
      title: "Einsatz gelöscht",
      body: client.facilityName,
      url: workerShiftLink(),
      htmlBody: shiftsHtml,
    });
  }

  // In-app notification to every admin. The request rows are gone, so the link
  // goes to the orders list, not the (now dead) request detail.
  await notifyAdmins(
    "order_status_changed",
    `${client.facilityName}: Anfrage gelöscht – ${existing.length} Schicht(en)`,
    "/admin/orders",
    shiftsHtml
  );

  // Message into the request's inbox thread so it reaches the office mailbox.
  const { getOrCreateRequestConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateRequestConversation(
    requestGroupId,
    user.id,
    dateLabel,
  );
  const now = new Date();
  const body = `Diese Anfrage (${dateLabel}, ${existing.length} Schicht(en)) wurde storniert und gelöscht.`;
  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: conversation.id, senderId: user.id, body },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    }),
    prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId: conversation.id, userId: user.id },
      },
      data: { lastReadAt: now },
    }),
  ]);
  await notifyAdmins(
    "new_message",
    `${client.facilityName} (${dateLabel}): ${body}`,
    inboxLink("admin", conversation.id),
  );

  await audit({
    userId: user.id,
    action: "order.request.delete",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: existing.length, hardDelete: true },
  });

  revalidatePath("/client/orders");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/schedule");
  revalidatePath("/worker");
  return { ok: true };
}

// Calendar request: one submission creates many shifts (orders) sharing a
// requestGroupId. Each shift keeps its own qualification, time and headcount
// and enters the normal pipeline (matching → assignment → confirmation).
export async function createOrderRequest(
  input: OrderRequestInput,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const clientId = await resolveClientId(user);
  if (!clientId) return { ok: false, error: "saveError" };
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { notes, shifts } = parsed.data;

  const requestGroupId = crypto.randomUUID();

  await prisma.order.createMany({
    data: shifts.map((s) => ({
      clientId: client.id,
      requestGroupId,
      requiredQualification: s.requiredQualification,
      shiftDate: new Date(`${s.date}T00:00:00.000Z`),
      startTime: s.startTime,
      endTime: s.endTime,
      breakMinutes: s.pause,
      quantity: s.quantity,
      notes: s.bereich ?? notes ?? null, // per-shift Wohnbereich, else request note
      status: "pending" as const,
    })),
  });

  const shiftsHtml = `
    <p><strong>${client.facilityName}</strong> hat eine neue Anfrage erstellt:</p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
      <thead>
        <tr style="background-color: #f3f4f6; text-align: left;">
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Datum</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Zeit</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Qualifikation</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Bereich/Notizen</th>
          <th style="padding: 10px; border: 1px solid #e5e7eb;">Anzahl</th>
        </tr>
      </thead>
      <tbody>
        ${shifts.map(s => `
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${formatDateDE(new Date(s.date))}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.startTime} - ${s.endTime}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.requiredQualification}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.bereich ?? notes ?? '-'}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${s.quantity}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // One summary notification per admin for the whole request.
  await notifyAdmins(
    "new_order",
    `${client.facilityName}: ${shifts.length} Schicht(en)`,
    orderLink("admin", requestGroupId),
    shiftsHtml
  );

  await audit({
    userId: user.id,
    action: "order.request.create",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: shifts.length },
  });

  revalidatePath("/client/orders");
  revalidatePath("/admin/orders");
  return { ok: true };
}

// Once a request is locked for editing (< 4h before the first shift), the
// client can still reach the office: the message lands as an inbox thread
// (one per order request, so follow-ups and admin replies stay together)
// plus an in-app notification for every admin.
export async function sendRequestMessage(
  requestGroupId: string,
  body: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const clientId = await resolveClientId(user);
  if (!clientId) return { ok: false, error: "saveError" };
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const parsed = z.string().trim().min(1).max(1000).safeParse(body);
  if (!parsed.success) return { ok: false, error: "saveError" };

  const first = await prisma.order.findFirst({
    where: { requestGroupId, clientId: client.id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: { shiftDate: true },
  });
  if (!first) return { ok: false, error: "forbidden" };

  const { getOrCreateRequestConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateRequestConversation(
    requestGroupId,
    user.id,
    formatDateDE(first.shiftDate),
  );
  const now = new Date();
  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: conversation.id, senderId: user.id, body: parsed.data },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    }),
    prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId: conversation.id, userId: user.id },
      },
      data: { lastReadAt: now },
    }),
  ]);

  const previewText =
    parsed.data.length > 80 ? `${parsed.data.slice(0, 80)}…` : parsed.data;
  await notifyAdmins(
    "new_message",
    `${client.facilityName} (${formatDateDE(first.shiftDate)}): ${previewText}`,
    inboxLink("admin", conversation.id),
  );

  await audit({
    userId: user.id,
    action: "order.request.message",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { length: parsed.data.length },
  });

  return { ok: true };
}

const BUCKET = "confirmations";

// The client digitally confirms a performed shift (Leistungsnachweis).
// Tamper-evident: records who, when, and the request IP (GDPR audit path).
// Admins/super_admins may confirm on the client's behalf (e.g. facility signed
// on paper / by phone) — for any shift regardless of date (past/present/future).
// The audit log keeps the acting user (actorRole), so on-behalf confirmations
// stay traceable.
export async function confirmService(formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "client")) {
    return { ok: false, error: "forbidden" };
  }

  const { serviceConfirmationSchema } = await import("@/lib/validations");

  const parsed = serviceConfirmationSchema.safeParse({
    assignmentId: formData.get("assignmentId"),
    method: formData.get("method"),
    hoursWorked: formData.get("hoursWorked"),
    clientNotes: formData.get("clientNotes") || undefined,
    signerName: formData.get("signerName") || undefined,
    signatureData: formData.get("signatureData") || undefined,
    adjustStart: formData.get("adjustStart") || undefined,
    adjustEnd: formData.get("adjustEnd") || undefined,
  });
  if (!parsed.success) {
    console.error("Zod Parse Error in confirmService:", parsed.error);
    return { ok: false, error: `Validation Error: ${parsed.error.message}` };
  }
  const data = parsed.data;

  // The assignment must belong to one of this client's orders, be worker-confirmed,
  // and not already have a service confirmation.
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
          client: { select: { userId: true, facilityName: true } },
        },
      },
      worker: { select: { userId: true, fullName: true, qualification: true } },
    },
  });
  if (
    !assignment ||
    (!isStaff && assignment.order.client.userId !== user.id) ||
    assignment.status !== "confirmed"
  ) {
    return { ok: false, error: "forbidden" };
  }
  if (assignment.serviceConfirmation) return { ok: false, error: "alreadyConfirmed" };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // The finalized artifact path: the generated signed PDF (electronic) or the
  // uploaded signed scan (upload). Both archive as tamper-proof `documentUrl`.
  let documentUrl: string | undefined;

  if (data.method === "upload") {
    // Method B — upload the signed scan to the private Storage bucket.
    const file = formData.get("document");
    console.log("Upload form data document:", file);
    if (!file || typeof file !== "object" || !('size' in file) || file.size === 0) {
      return { ok: false, error: "fileRequired" };
    }
    const uploadedFile = file as File;
    const path = `${data.assignmentId}/${Date.now()}-${uploadedFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, await uploadedFile.arrayBuffer(), {
        contentType: uploadedFile.type,
        upsert: false,
      });
    if (error) {
      console.error("Supabase upload error:", error);
      return { ok: false, error: `Supabase Error: ${error.message}` };
    }
    documentUrl = path;
  } else {
    // Method A — electronic confirmation in Textform (§ 126b BGB): the confirmer
    // types their name and consents; the binding evidence is the timestamp + IP +
    // legal statement baked into the immutable Leistungsnachweis PDF. A drawn
    // signature image is optional (legacy) and no longer required.
    if (!data.signerName) return { ok: false, error: "nameRequired" };

    const [{ renderLeistungsnachweisPdf }, { qualLabel, methodLabel }] =
      await Promise.all([
        import("@/lib/pdf/leistungsnachweis"),
        import("@/lib/invoicing"),
      ]);

    const worker = await prisma.worker.findUnique({
      where: { id: assignment.workerId },
      select: { fullName: true, qualification: true },
    });
    if (!worker) return { ok: false, error: "saveError" };

    const pdf = await renderLeistungsnachweisPdf({
      facilityName: assignment.order.client.facilityName,
      workerName: worker.fullName,
      qualificationLabel: qualLabel[worker.qualification],
      shiftDate: assignment.order.shiftDate.toISOString().slice(0, 10),
      startTime: assignment.order.startTime,
      endTime: assignment.order.endTime,
      hours: data.hoursWorked,
      methodLabel: methodLabel.electronic,
      isElectronic: true,
      signatureData: data.signatureData,
      signerName: data.signerName,
      confirmedByEmail: user.email,
      confirmedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
      ipAddress: ip,
      orderId: assignment.order.id,
      assignmentId: data.assignmentId,
      draft: false,
    });

    const path = `${data.assignmentId}/signed/leistungsnachweis-${Date.now()}.pdf`;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Uint8Array(pdf), {
        contentType: "application/pdf",
        upsert: false,
      });
    if (error) return { ok: false, error: "saveError" };
    documentUrl = path;
  }

  // Did the client ask for a corrected shift window while confirming? Stored on
  // the confirmation so the office can approve/reject it from the inbox thread.
  const reqStart = assignment.order.startTime;
  const reqEnd = assignment.order.endTime;
  const timeChangeRequested =
    !!data.adjustStart &&
    !!data.adjustEnd &&
    (data.adjustStart !== reqStart || data.adjustEnd !== reqEnd);

  await prisma.$transaction(async (tx) => {
    await tx.serviceConfirmation.create({
      data: {
        assignmentId: data.assignmentId,
        confirmedById: user.id,
        method: data.method,
        signatureData: data.method === "electronic" ? data.signatureData : null,
        documentUrl: documentUrl ?? null,
        hoursWorked: data.hoursWorked,
        clientNotes: data.clientNotes,
        ipAddress: ip,
        requestedStart: timeChangeRequested ? data.adjustStart : null,
        requestedEnd: timeChangeRequested ? data.adjustEnd : null,
      },
    });

    // Advance the order to "confirmed" once every worker-confirmed assignment
    // has a service confirmation.
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

    // Notify the worker + admins (CLAUDE.md §8 "Service confirmed").
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
          content: `${assignment.order.client.facilityName} · ${formatDateDE(assignment.order.shiftDate)} · ${data.hoursWorked} Std.`,
          // Worker opens their shift sheet; office opens the order request.
          link: r.role === "worker" ? workerShiftLink() : orderLink(r.role, reqGroup),
        })),
      });
    }
  });

  // #6 — the client requested a corrected shift window while confirming. This
  // needs office approval, so it lands as a message in the request's inbox thread
  // (plus an in-app notification for every admin). The admin approves or rejects
  // it from the thread's review dialog; the order times are NOT changed here —
  // only the request is filed (requestedStart/End on the confirmation).
  if (timeChangeRequested && assignment.order.client.userId) {
    const requestGroupId = assignment.order.requestGroupId ?? assignment.order.id;
    const dateLabel = formatDateDE(assignment.order.shiftDate);
    const { getOrCreateRequestConversation } = await import("@/lib/inbox");
    const conversation = await getOrCreateRequestConversation(
      requestGroupId,
      assignment.order.client.userId,
      dateLabel,
    );
    const now = new Date();
    const noteSuffix = data.clientNotes ? ` – ${data.clientNotes}` : "";
    const body = `Zeitkorrektur angefragt (${dateLabel}): ${reqStart}–${reqEnd} → ${data.adjustStart}–${data.adjustEnd}. Bitte prüfen und freigeben.${noteSuffix}`;
    // Mark the sender's own copy read only if they are actually a participant
    // (the client). An admin confirming on behalf is not on the thread.
    const senderIsParticipant = user.id === assignment.order.client.userId;
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: user.id, body },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
      ...(senderIsParticipant
        ? [
            prisma.conversationParticipant.update({
              where: {
                conversationId_userId: { conversationId: conversation.id, userId: user.id },
              },
              data: { lastReadAt: now },
            }),
          ]
        : []),
    ]);
    await notifyAdmins(
      "new_message",
      `${assignment.order.client.facilityName} (${dateLabel}): ${body}`,
      inboxLink("admin", conversation.id),
    );
  }

  await audit({
    userId: user.id,
    action: "service.confirm",
    entity: "Assignment",
    entityId: data.assignmentId,
    ipAddress: ip,
    metadata: {
      method: data.method,
      hours: data.hoursWorked,
      actorRole: user.role,
      ...(timeChangeRequested
        ? { timeChange: `${reqStart}-${reqEnd} → ${data.adjustStart}-${data.adjustEnd}` }
        : {}),
    },
  });

  // Mobile push: worker + office (mirrors the in-app service_confirmed notice).
  const confirmBody = `${assignment.order.client.facilityName} · ${formatDateDE(assignment.order.shiftDate)} · ${data.hoursWorked} Std.`;
  const confirmGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const pushAdmins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  const confirmHtml = `
    <p>Die Leistung für den folgenden Einsatz wurde bestätigt:</p>
    ${buildShiftHtmlTable([{
      date: assignment.order.shiftDate,
      startTime: assignment.order.startTime,
      endTime: assignment.order.endTime,
      qualification: assignment.worker.qualification,
      facilityName: assignment.order.client.facilityName,
      workerName: assignment.worker.fullName,
    }])}
    <p><strong>Bestätigte Stunden:</strong> ${data.hoursWorked} Std.</p>
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
      { title: "Leistung bestätigt", body: confirmBody, url: orderLink("admin", confirmGroup), htmlBody: confirmHtml },
    ),
  ]);

  revalidatePath("/client/orders");
  revalidatePath(`/client/orders/${assignment.order.requestGroupId ?? assignment.order.id}`);
  // Admin request detail is keyed by requestGroupId, not orderId.
  revalidatePath(`/admin/orders/${assignment.order.requestGroupId ?? assignment.order.id}`);
  // The worker's schedule shows the signed-off hours immediately.
  revalidatePath("/worker");
  return { ok: true };
}

export async function getWorkerProfilePreview(workerId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return null;

  const link = await prisma.assignment.findFirst({
    where: { workerId, order: { client: { userId: user.id } } },
    select: { id: true },
  });
  if (!link) return null;

  const { getWorkerProfileData } = await import("@/lib/worker-profile");
  return getWorkerProfileData(workerId);
}

// ─────────── Hours correction on an ALREADY-signed shift (proposal → approval) ───────────
//
// A signed Leistungsnachweis is a legal record, so the office cannot silently
// overwrite the hours. Instead the admin PROPOSES a new figure; the original
// stays valid until the client RE-CONFIRMS it from their inbox, which then
// re-generates the signed PDF and notifies the worker + office.

const hoursCorrectionSchema = z.object({
  assignmentId: z.string().uuid(),
  hours: z.coerce.number().min(0).max(24),
  note: z.string().trim().max(1000).optional(),
});

// Admin proposes changed hours on a client-signed shift → client's inbox.
export async function requestHoursCorrection(input: {
  assignmentId: string;
  hours: number;
  note?: string;
}): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }
  const parsed = hoursCorrectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { assignmentId, hours, note } = parsed.data;

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      serviceConfirmation: { select: { id: true, hoursWorked: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
      worker: { select: { fullName: true } },
    },
  });
  if (!assignment || !assignment.serviceConfirmation) {
    return { ok: false, error: "notConfirmed" };
  }
  const current =
    assignment.serviceConfirmation.hoursWorked != null
      ? Number(assignment.serviceConfirmation.hoursWorked)
      : null;
  if (current != null && Math.abs(current - hours) < 0.001) {
    return { ok: false, error: "noChange" };
  }

  await prisma.serviceConfirmation.update({
    where: { id: assignment.serviceConfirmation.id },
    data: {
      correctionHours: hours,
      correctionNote: note || null,
      correctionRequestedBy: user.id,
      correctionRequestedAt: new Date(),
    },
  });

  const dateLabel = formatDateDE(assignment.order.shiftDate);
  const requestGroupId = assignment.order.requestGroupId ?? assignment.order.id;
  const clientUserId = assignment.order.client.userId;
  if (clientUserId) {
    const noteSuffix = note ? ` – ${note}` : "";
    const body = `Stundenkorrektur (${dateLabel}, ${assignment.worker.fullName}): ${current ?? "?"} → ${hours} Std. Bitte im Portal neu bestätigen.${noteSuffix}`;
    const { getOrCreateRequestConversation } = await import("@/lib/inbox");
    const conversation = await getOrCreateRequestConversation(
      requestGroupId,
      clientUserId,
      dateLabel,
    );
    const now = new Date();
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: user.id, body },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
    ]);
    await prisma.notification.create({
      data: {
        userId: clientUserId,
        type: "order_status_changed",
        channel: "in_app",
        content: `Bitte Stunden neu bestätigen (${dateLabel}): ${hours} Std.`,
        link: inboxLink("client", conversation.id),
      },
    });
    await pushToUsers([clientUserId], {
      title: "Stunden neu bestätigen",
      body: `${assignment.order.client.facilityName} · ${dateLabel} · ${hours} Std.`,
      url: inboxLink("client", conversation.id),
    });
  }

  await audit({
    userId: user.id,
    action: "service.correctionRequest",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { from: current, to: hours, hasNote: !!note },
  });

  revalidatePath(`/admin/orders/${requestGroupId}`);
  revalidatePath(`/client/orders/${requestGroupId}`);
  return { ok: true };
}

// Client (or admin on their behalf) re-confirms the proposed hours → regenerates
// the signed Leistungsnachweis, applies the new hours, and notifies worker + office.
export async function confirmHoursCorrection(input: {
  assignmentId: string;
  signerName: string;
  signatureData?: string;
}): Promise<ActionState> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "client")) return { ok: false, error: "forbidden" };
  if (
    !z.string().uuid().safeParse(input.assignmentId).success ||
    !z.string().trim().min(2).max(120).safeParse(input.signerName).success
  ) {
    return { ok: false, error: "nameRequired" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: input.assignmentId },
    include: {
      serviceConfirmation: true,
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
      worker: { select: { userId: true, fullName: true, qualification: true } },
    },
  });
  const sc = assignment?.serviceConfirmation;
  if (!assignment || !sc || sc.correctionHours == null) return { ok: false, error: "forbidden" };
  if (!isStaff && assignment.order.client.userId !== user.id) {
    return { ok: false, error: "forbidden" };
  }

  const newHours = Number(sc.correctionHours);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // Regenerate the signed Leistungsnachweis with the corrected hours.
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
    hours: newHours,
    methodLabel: methodLabel.electronic,
    isElectronic: true,
    signatureData: input.signatureData,
    signerName: input.signerName.trim(),
    confirmedByEmail: user.email,
    confirmedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    ipAddress: ip,
    orderId: assignment.order.id,
    assignmentId: assignment.id,
    draft: false,
  });
  const path = `${assignment.id}/signed/leistungsnachweis-${Date.now()}.pdf`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Uint8Array(pdf), { contentType: "application/pdf", upsert: false });
  if (error) return { ok: false, error: "saveError" };

  await prisma.serviceConfirmation.update({
    where: { id: sc.id },
    data: {
      hoursWorked: newHours,
      method: "electronic",
      signatureData: input.signatureData ?? null,
      documentUrl: path,
      confirmedById: user.id,
      confirmedAt: new Date(),
      ipAddress: ip,
      correctionHours: null,
      correctionNote: null,
      correctionRequestedBy: null,
      correctionRequestedAt: null,
    },
  });

  const dateLabel = formatDateDE(assignment.order.shiftDate);
  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const body = `Stunden aktualisiert & bestätigt (${dateLabel}): ${newHours} Std.`;
  const summary = `${assignment.order.client.facilityName} · ${dateLabel} · ${newHours} Std.`;

  // Land the confirmation in the worker's inbox thread (worker ↔ agency).
  const { getOrCreateAssignmentConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateAssignmentConversation(assignment.id);
  const now = new Date();
  if (conversation) {
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: user.id, body },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
    ]);
  }

  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true, role: true },
  });
  const recipients = [
    { id: assignment.worker.userId, role: "worker" as const },
    ...admins,
  ];
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type: "service_confirmed" as const,
      channel: "in_app" as const,
      content: summary,
      link: r.role === "worker" ? workerShiftLink() : orderLink(r.role, reqGroup),
    })),
  });
  await Promise.all([
    pushToUsers([assignment.worker.userId], {
      title: "Stunden aktualisiert",
      body: summary,
      url: workerShiftLink(),
    }),
    pushToUsers(
      admins.map((a) => a.id),
      { title: "Stunden aktualisiert", body: summary, url: orderLink("admin", reqGroup) },
    ),
  ]);

  await audit({
    userId: user.id,
    action: "service.correctionConfirm",
    entity: "Assignment",
    entityId: assignment.id,
    ipAddress: ip,
    metadata: { hours: newHours, actorRole: user.role },
  });

  revalidatePath("/worker");
  revalidatePath("/client/orders");
  revalidatePath(`/client/orders/${reqGroup}`);
  revalidatePath(`/admin/orders/${reqGroup}`);
  return { ok: true };
}

// Client (or admin) declines the proposed correction → clears it, notifies office.
export async function rejectHoursCorrection(assignmentId: string): Promise<ActionState> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "client")) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(assignmentId).success) return { ok: false, error: "saveError" };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      serviceConfirmation: { select: { id: true, correctionHours: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
    },
  });
  const sc = assignment?.serviceConfirmation;
  if (!assignment || !sc || sc.correctionHours == null) return { ok: false, error: "forbidden" };
  if (!isStaff && assignment.order.client.userId !== user.id) {
    return { ok: false, error: "forbidden" };
  }

  await prisma.serviceConfirmation.update({
    where: { id: sc.id },
    data: {
      correctionHours: null,
      correctionNote: null,
      correctionRequestedBy: null,
      correctionRequestedAt: null,
    },
  });

  const dateLabel = formatDateDE(assignment.order.shiftDate);
  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  await notifyAdmins(
    "order_status_changed",
    `Stundenkorrektur abgelehnt (${dateLabel}, ${assignment.order.client.facilityName}).`,
    orderLink("admin", reqGroup),
  );
  await audit({
    userId: user.id,
    action: "service.correctionReject",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { actorRole: user.role },
  });

  revalidatePath(`/admin/orders/${reqGroup}`);
  revalidatePath(`/client/orders/${reqGroup}`);
  return { ok: true };
}
