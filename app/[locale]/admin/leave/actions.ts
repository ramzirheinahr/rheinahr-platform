"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { workerShiftLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";

export async function reviewLeaveRequest(
  requestId: string,
  decisions: { date: string; status: "approved" | "rejected"; hours: number }[]
) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin", "super_admin"])) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.findUnique({
        where: { id: requestId },
        include: { days: true },
      });

      if (!request) {
        throw new Error("Leave request not found");
      }

      // Determine overall status based on decisions
      const hasApproved = decisions.some((d) => d.status === "approved");
      const overallStatus = hasApproved ? "approved" : "rejected";

      // Update the request status
      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: overallStatus },
      });

      // Update each day
      for (const decision of decisions) {
        const dayRecord = request.days.find(
          (d) => d.date.toISOString().slice(0, 10) === decision.date
        );
        if (dayRecord) {
          await tx.leaveDay.update({
            where: { id: dayRecord.id },
            data: {
              status: decision.status,
              hours: decision.hours,
            },
          });
        }
      }

      // Add a system message to the conversation to notify the worker
      const conversation = await tx.conversation.findUnique({
        where: { leaveRequestId: requestId },
      });

      if (conversation) {
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: user.id,
            body: `Dein Urlaubsantrag wurde bearbeitet. Status: ${
              overallStatus === "approved" ? "Genehmigt" : "Abgelehnt"
            }.`,
          },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      }

      return { ok: true };
    });

    return result;
  } catch (error) {
    console.error("Failed to review leave request:", error);
    return { ok: false, error: "Failed to review request" };
  }
}

// Admin cancels a worker's leave ENTIRELY (full authority): every day of the
// request is removed so the leave no longer blocks the schedule or counts toward
// hours, and the request is marked rejected (kept for history + audit). The
// worker is notified. Works whether the leave was pending or already approved.
export async function cancelLeaveEntirely(
  requestId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin", "super_admin"])) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        workerId: true,
        worker: { select: { fullName: true, userId: true } },
      },
    });
    if (!request) return { ok: false, error: "not_found" };

    await prisma.$transaction(async (tx) => {
      await tx.leaveDay.deleteMany({ where: { leaveRequestId: requestId } });
      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: "rejected" },
      });

      const conversation = await tx.conversation.findUnique({
        where: { leaveRequestId: requestId },
      });
      if (conversation) {
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: user.id,
            body: "Dein Urlaub wurde von der Verwaltung vollständig storniert.",
          },
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      }

      await tx.notification.create({
        data: {
          userId: request.worker.userId,
          type: "order_status_changed",
          channel: "in_app",
          content: "Ihr Urlaub wurde storniert.",
          link: workerShiftLink(),
        },
      });
    });

    await pushToUsers([request.worker.userId], {
      title: "Urlaub storniert",
      body: "Ihr Urlaub wurde von der Verwaltung storniert.",
      url: workerShiftLink(),
    });

    await audit({
      userId: user.id,
      action: "leave.cancel",
      entity: "LeaveRequest",
      entityId: requestId,
      metadata: { workerId: request.workerId },
    });

    revalidatePath("/admin/schedule");
    revalidatePath("/worker");
    return { ok: true };
  } catch (error) {
    console.error("Failed to cancel leave:", error);
    return { ok: false, error: "Failed to cancel leave" };
  }
}
