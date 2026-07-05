"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Marks every unread in-app notification of the current user as read.
export async function markAllNotificationsRead(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/admin");
  revalidatePath("/client");
  revalidatePath("/worker");
  return { ok: true };
}

// Marks a single notification (owned by the current user) as read — called when
// the user clicks a notification to open its target.
export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };

  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath("/admin");
  revalidatePath("/client");
  revalidatePath("/worker");
  return { ok: true };
}
