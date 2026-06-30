"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";

export type ActionState = { ok: boolean; error?: string };

// Per-assignment messaging between the assigned care worker and admins.
export async function sendMessage(
  assignmentId: string,
  body: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };

  const text = body.trim();
  if (!text || text.length > 2000) return { ok: false, error: "saveError" };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, worker: { select: { userId: true } } },
  });
  if (!assignment) return { ok: false, error: "saveError" };

  const isWorker = assignment.worker.userId === user.id;
  const isAdmin = roleSatisfies(user.role, ["admin"]);
  if (!isWorker && !isAdmin) return { ok: false, error: "forbidden" };

  await prisma.message.create({
    data: { assignmentId, senderId: user.id, body: text },
  });

  // Notify the other side (worker → admins, admin → the worker).
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  const recipients = isWorker
    ? (
        await prisma.user.findMany({
          where: { role: { in: ["admin", "super_admin"] }, active: true },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [assignment.worker.userId];

  if (recipients.length) {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: "new_message" as const,
        channel: "in_app" as const,
        content: preview,
      })),
    });
  }

  await audit({
    userId: user.id,
    action: "message.send",
    entity: "Assignment",
    entityId: assignmentId,
  });

  return { ok: true };
}
