"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  orderStatuses,
  orderRequestSchema,
  type OrderRequestInput,
} from "@/lib/validations";
import { diffRequestShifts } from "@/lib/orders";
import { formatDateDE } from "@/lib/utils";
import type { OrderStatus, Qualification } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

// Admin-created calendar request on behalf of a chosen client. Mirrors the
// client-side createOrderRequest but the admin selects the target client, and
// the client's user is notified that an order was added to their account.
export async function createOrderRequestForClient(
  clientId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, userId: true, facilityName: true },
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
      notes: s.bereich ?? notes ?? null,
      status: "pending" as const,
    })),
  });

  // Let the client know an order was created on their account.
  if (client.userId) {
    await prisma.notification.create({
      data: {
        userId: client.userId,
        type: "new_order",
        channel: "in_app",
        content: `${client.facilityName}: ${shifts.length} Schicht(en)`,
      },
    });
  }

  await audit({
    userId: admin.id,
    action: "order.request.create",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: shifts.length, clientId },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/client/orders");
  return { ok: true };
}

// Admin adjusting a request: apply only the actual changes. Admins are not
// bound to the client's 4h cutoff — they may edit at any time, even after a
// shift has run. Untouched shifts keep their orders, assignments and
// confirmations; only modified/removed shifts are replaced.
export async function updateOrderRequestAsAdmin(
  requestGroupId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const existing = await prisma.order.findMany({
    where: { requestGroupId },
    select: {
      id: true,
      clientId: true,
      status: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      quantity: true,
      notes: true,
      requiredQualification: true,
    },
  });
  if (existing.length === 0) return { ok: false, error: "saveError" };
  const clientId = existing[0].clientId;

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

  if (updates.length + creates.length + deleteIds.length > 0) {
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
                clientId,
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
  }

  await audit({
    userId: admin.id,
    action: "order.request.update",
    entity: "Order",
    entityId: requestGroupId,
    metadata: {
      byAdmin: true,
      updated: updates.length,
      created: creates.length,
      deleted: deleteIds.length,
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${requestGroupId}`);
  revalidatePath("/client/orders");
  return { ok: true };
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(orderStatuses as readonly string[]).includes(status)) {
    return { ok: false, error: "saveError" };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: status as OrderStatus },
  });

  await audit({
    userId: admin.id,
    action: "order.status",
    entity: "Order",
    entityId: orderId,
    metadata: { status },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

// Assign a worker to an order, notify them, and advance the order to "assigned".
export async function assignWorker(
  orderId: string,
  workerId: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const [order, worker] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, shiftDate: true, startTime: true, endTime: true },
    }),
    prisma.worker.findUnique({
      where: { id: workerId },
      select: { userId: true },
    }),
  ]);
  if (!order || !worker) return { ok: false, error: "saveError" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.assignment.create({
        data: { orderId, workerId, status: "pending" },
      });
      // Advance the pipeline once the first worker is assigned.
      if (["pending", "review", "availability_check"].includes(order.status)) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "assigned" },
        });
      }
      // In-app notification to the worker (CLAUDE.md §8 "Worker assigned").
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "worker_assigned",
          channel: "in_app",
          content: `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime}`,
        },
      });
    });
  } catch {
    // Unique (orderId, workerId) — already assigned, treat as a soft failure.
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "assignment.create",
    entity: "Order",
    entityId: orderId,
    metadata: { workerId },
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}
