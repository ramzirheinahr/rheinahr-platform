"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

// Worker accepts or declines an assignment they own.
export async function respondAssignment(
  assignmentId: string,
  accept: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") return { ok: false, error: "forbidden" };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { select: { userId: true, fullName: true } },
      order: {
        select: {
          id: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { userId: true } },
        },
      },
    },
  });
  if (!assignment || assignment.worker.userId !== user.id) {
    return { ok: false, error: "forbidden" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        status: accept ? "confirmed" : "declined",
        confirmedAt: accept ? new Date() : null,
      },
    });

    if (accept) {
      await tx.order.update({
        where: { id: assignment.order.id },
        data: { status: "accepted" },
      });
      // Notify the client (CLAUDE.md §8 "Worker confirms").
      const recipients = await tx.user.findMany({
        where: {
          OR: [
            { id: assignment.order.client.userId },
            { role: { in: ["admin", "super_admin"] }, active: true },
          ],
        },
        select: { id: true },
      });
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((r) => ({
            userId: r.id,
            type: "worker_confirmed" as const,
            channel: "in_app" as const,
            content: `${assignment.worker.fullName}: ${assignment.order.shiftDate
              .toISOString()
              .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`,
          })),
        });
      }
    }
  });

  await audit({
    userId: user.id,
    action: accept ? "assignment.confirm" : "assignment.decline",
    entity: "Assignment",
    entityId: assignmentId,
  });

  revalidatePath("/worker");
  revalidatePath(`/admin/orders/${assignment.order.id}`);
  return { ok: true };
}
