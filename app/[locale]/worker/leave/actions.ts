"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function submitLeaveRequest(dates: string[]) {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") {
    return { ok: false, error: "Unauthorized" };
  }

  const worker = await prisma.worker.findUnique({
    where: { userId: user.id },
  });

  if (!worker) {
    return { ok: false, error: "Worker not found" };
  }

  if (!dates || dates.length === 0) {
    return { ok: false, error: "No dates provided" };
  }

  try {
    const leaveRequest = await prisma.$transaction(async (tx) => {
      // Create the LeaveRequest and LeaveDays
      const request = await tx.leaveRequest.create({
        data: {
          workerId: worker.id,
          status: "pending",
          days: {
            create: dates.map((date) => ({
              date: new Date(`${date}T00:00:00Z`),
              hours: 7.0, // Default hours, subject to change by admin
              status: "pending",
            })),
          },
        },
      });

      // Find super admins and admins to add to the conversation
      const agencyUsers = await tx.user.findMany({
        where: { role: { in: ["super_admin", "admin"] }, active: true },
        select: { id: true },
      });

      // Create a conversation for the Inbox
      await tx.conversation.create({
        data: {
          subject: `Urlaubsantrag: ${worker.fullName}`,
          leaveRequestId: request.id,
          createdById: user.id,
          participants: {
            create: [
              { userId: user.id },
              ...agencyUsers.map((u) => ({ userId: u.id })),
            ],
          },
          messages: {
            create: [
              {
                senderId: user.id,
                body: `Ich beantrage Urlaub für folgende Tage: ${dates.join(", ")}`,
              },
            ],
          },
        },
      });

      return request;
    });

    return { ok: true, requestId: leaveRequest.id };
  } catch (error) {
    console.error("Failed to submit leave request:", error);
    return { ok: false, error: "Failed to submit request" };
  }
}

export async function requestLeaveEdit(leaveRequestId: string, message: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { conversation: true },
    });

    if (!request) {
      return { ok: false, error: "Not found" };
    }

    if (request.workerId !== (await prisma.worker.findUnique({ where: { userId: user.id } }))?.id) {
      return { ok: false, error: "Unauthorized" };
    }

    if (!request.conversation) {
      return { ok: false, error: "Conversation missing" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId: request.conversation!.id,
          senderId: user.id,
          body: `Änderungsanfrage für Urlaub: ${message}`,
        },
      });

      await tx.conversation.update({
        where: { id: request.conversation!.id },
        data: { lastMessageAt: new Date() },
      });
    });

    return { ok: true };
  } catch (error) {
    console.error("Failed to request leave edit:", error);
    return { ok: false, error: "Failed to request edit" };
  }
}
