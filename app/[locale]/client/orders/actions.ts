"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderSchema } from "@/lib/validations";

export type ActionState = { ok: boolean; error?: string };

export async function createOrder(formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "client") return { ok: false, error: "forbidden" };

  const client = await prisma.client.findUnique({
    where: { userId: user.id },
    select: { id: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const parsed = orderSchema.safeParse({
    requiredQualification: formData.get("requiredQualification"),
    shiftDate: formData.get("shiftDate"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    quantity: formData.get("quantity"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { ok: false, error: "saveError" };
  const data = parsed.data;

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      requiredQualification: data.requiredQualification,
      shiftDate: data.shiftDate,
      startTime: data.startTime,
      endTime: data.endTime,
      quantity: data.quantity,
      notes: data.notes,
      status: "pending",
    },
  });

  // In-app notification to every admin / super_admin (CLAUDE.md §8 "New order").
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
        content: `${client.facilityName}: ${data.shiftDate.toISOString().slice(0, 10)} ${data.startTime}–${data.endTime}`,
      })),
    });
  }

  await audit({
    userId: user.id,
    action: "order.create",
    entity: "Order",
    entityId: order.id,
  });

  revalidatePath("/client/orders");
  revalidatePath("/admin/orders");
  return { ok: true };
}
