"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isRequestEditable } from "@/lib/orders";
import { orderRequestSchema, type OrderRequestInput } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

// Edit a still-pending request: replace all its shifts (only allowed before any
// admin action — every shift pending and unassigned).
export async function updateOrderRequest(
  requestGroupId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const existing = await prisma.order.findMany({
    where: { requestGroupId, clientId: client.id },
    select: { status: true, _count: { select: { assignments: true } } },
  });
  if (existing.length === 0) return { ok: false, error: "forbidden" };
  if (!isRequestEditable(existing)) return { ok: false, error: "locked" };

  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { notes, shifts } = parsed.data;

  await prisma.$transaction([
    prisma.order.deleteMany({ where: { requestGroupId, clientId: client.id } }),
    prisma.order.createMany({
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
    }),
  ]);

  await audit({
    userId: user.id,
    action: "order.request.update",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: shifts.length },
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
  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "new_order" as const,
        channel: "in_app" as const,
        content: `${client.facilityName}: ${shifts.length} Schicht(en)`,
      })),
    });
  }

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
