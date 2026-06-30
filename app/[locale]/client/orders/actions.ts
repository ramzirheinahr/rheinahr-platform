"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderRequestSchema, type OrderRequestInput } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

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
