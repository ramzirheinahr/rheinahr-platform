"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { diffRequestShifts, isRequestEditable } from "@/lib/orders";
import { formatDateDE } from "@/lib/utils";
import { orderRequestSchema, type OrderRequestInput } from "@/lib/validations";
import type { Qualification } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

async function notifyAdmins(
  type: "new_order" | "order_status_changed" | "new_message",
  content: string,
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
// client can still reach the office: the message lands as an in-app
// notification for every admin, referencing the facility and the request date.
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

  await notifyAdmins(
    "new_message",
    `${client.facilityName} (${formatDateDE(first.shiftDate)}): ${parsed.data}`,
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
export async function confirmService(formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

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
      order: { select: { id: true, requestGroupId: true, client: { select: { userId: true } } } },
      worker: { select: { userId: true } },
    },
  });
  if (
    !assignment ||
    assignment.order.client.userId !== user.id ||
    assignment.status !== "confirmed"
  ) {
    return { ok: false, error: "forbidden" };
  }
  if (assignment.serviceConfirmation) return { ok: false, error: "alreadyConfirmed" };

  // Method B — upload the signed scan to the private Storage bucket.
  let documentUrl: string | undefined;
  if (data.method === "upload") {
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
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

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
      select: { id: true },
    });
    if (recipients.length) {
      await tx.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
          type: "service_confirmed" as const,
          channel: "in_app" as const,
          content: `${data.hoursWorked}h`,
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
    metadata: { method: data.method, hours: data.hoursWorked },
  });

  revalidatePath("/client/orders");
  revalidatePath(`/client/orders/${assignment.order.requestGroupId ?? assignment.order.id}`);
  revalidatePath(`/admin/orders/${assignment.order.id}`);
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
