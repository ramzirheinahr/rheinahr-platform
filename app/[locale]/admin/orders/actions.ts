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
import type { OrderStatus } from "@prisma/client";

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
          content: `${order.shiftDate.toISOString().slice(0, 10)} ${order.startTime}–${order.endTime}`,
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
