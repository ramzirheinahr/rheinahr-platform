"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";

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
