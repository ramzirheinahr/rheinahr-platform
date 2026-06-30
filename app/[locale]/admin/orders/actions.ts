"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderStatuses } from "@/lib/validations";
import type { OrderStatus } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
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
