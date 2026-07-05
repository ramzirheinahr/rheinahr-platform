"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { diffRequestShifts, isRequestEditable, isRequestCancelable } from "@/lib/orders";
import { formatDateDE } from "@/lib/utils";
import { orderRequestSchema, type OrderRequestInput } from "@/lib/validations";
import { orderLink, inboxLink, workerShiftLink } from "@/lib/notify";
import type { Qualification } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

async function notifyAdmins(
  type: "new_order" | "order_status_changed" | "new_message",
  content: string,
  link?: string,
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

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
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
        data: { quantity: u.quantity, notes: u.notes },
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
              quantity: s.quantity,
              notes: s.notes,
              status: "pending" as const,
            })),
          }),
        ]
      : []),
  ]);

  // Changed shifts re-enter the pipeline — tell the admins to re-process.
  await notifyAdmins(
    "order_status_changed",
    `${client.facilityName}: Anfrage geändert – ${changes} Schicht(en) betroffen`,
    orderLink("admin", requestGroupId),
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

// Cancel a whole request (all shifts sharing the requestGroupId) — a SOFT
// cancel: the records stay in the database (status → cancelled) so the history
// is preserved; nothing is deleted. Allowed until a shift is confirmed / running
// / completed (isRequestCancelable), which is broader than the edit cutoff since
// cancelling is non-destructive. The office (admins) is alerted twice: an in-app
// notification AND a message in the request's inbox thread, so it lands in their
// mailbox and can't be missed.
export async function cancelOrderRequest(
  requestGroupId: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const existing = await prisma.order.findMany({
    where: { requestGroupId, clientId: client.id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: { id: true, status: true, shiftDate: true },
  });
  if (existing.length === 0) return { ok: false, error: "forbidden" };
  if (!isRequestCancelable(existing)) return { ok: false, error: "locked" };

  await prisma.order.updateMany({
    where: { requestGroupId, clientId: client.id, status: { not: "cancelled" } },
    data: { status: "cancelled" },
  });

  const dateLabel = formatDateDE(existing[0].shiftDate);

  // In-app notification to every admin.
  await notifyAdmins(
    "order_status_changed",
    `${client.facilityName}: Anfrage storniert – ${existing.length} Schicht(en)`,
    orderLink("admin", requestGroupId),
  );

  // Message into the request's inbox thread so it reaches the office mailbox.
  const { getOrCreateRequestConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateRequestConversation(
    requestGroupId,
    user.id,
    dateLabel,
  );
  const now = new Date();
  const body = `Diese Anfrage (${dateLabel}, ${existing.length} Schicht(en)) wurde storniert.`;
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
    action: "order.request.cancel",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: existing.length },
  });

  revalidatePath("/client/orders");
  revalidatePath(`/client/orders/${requestGroupId}`);
  revalidatePath("/admin/orders");
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

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
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
      quantity: s.quantity,
      notes: s.bereich ?? notes ?? null, // per-shift Wohnbereich, else request note
      status: "pending" as const,
    })),
  });

  // One summary notification per admin for the whole request.
  await notifyAdmins(
    "new_order",
    `${client.facilityName}: ${shifts.length} Schicht(en)`,
    orderLink("admin", requestGroupId),
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

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
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
    clientNotes: formData.get("clientNotes"),
    signatureData: formData.get("signatureData") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "saveError" };
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
      worker: { select: { userId: true } },
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
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "fileRequired" };
    }
    const path = `${data.assignmentId}/${Date.now()}-${file.name}`;
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
    if (error) return { ok: false, error: "saveError" };
    documentUrl = path;
  } else {
    // Method A — the client draws an electronic signature; bake it into the
    // finalized Leistungsnachweis PDF and archive that immutable document.
    if (!data.signatureData) return { ok: false, error: "signatureRequired" };

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

  await audit({
    userId: user.id,
    action: "service.confirm",
    entity: "Assignment",
    entityId: data.assignmentId,
    ipAddress: ip,
    metadata: { method: data.method, hours: data.hoursWorked, actorRole: user.role },
  });

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
