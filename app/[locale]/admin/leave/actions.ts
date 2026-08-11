"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { workerShiftLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { formatDateDE } from "@/lib/utils";

export async function reviewLeaveRequest(
  requestId: string,
  decisions: { date: string; status: "pending" | "approved" | "rejected"; hours: number }[]
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
      const hasPending = decisions.some((d) => d.status === "pending");
      
      let overallStatus: "pending" | "approved" | "rejected" = "rejected";
      if (hasApproved) {
        overallStatus = "approved";
      } else if (hasPending) {
        overallStatus = "pending";
      }

      // Update the request status
      await tx.leaveRequest.update({
        where: { id: requestId },
        data: { status: overallStatus },
      });

      // Calculate days to delete (present in request but not in decisions)
      const decisionDates = decisions.map((d) => d.date);
      const daysToDelete = request.days.filter(
        (d) => !decisionDates.includes(d.date.toISOString().slice(0, 10))
      );
      
      if (daysToDelete.length > 0) {
        await tx.leaveDay.deleteMany({
          where: { id: { in: daysToDelete.map((d) => d.id) } },
        });
      }

      // Update existing days and create new days
      await Promise.all(
        decisions.map((decision) => {
          const dayRecord = request.days.find(
            (d) => d.date.toISOString().slice(0, 10) === decision.date
          );
          if (dayRecord) {
            return tx.leaveDay.update({
              where: { id: dayRecord.id },
              data: {
                status: decision.status,
                hours: decision.hours,
              },
            });
          } else {
            return tx.leaveDay.create({
              data: {
                leaveRequestId: requestId,
                date: new Date(decision.date + "T00:00:00Z"),
                status: decision.status,
                hours: decision.hours,
              },
            });
          }
        })
      );

      // Add a system message to the conversation to notify the worker
      const conversation = await tx.conversation.findUnique({
        where: { leaveRequestId: requestId },
      });

      if (conversation) {
        let statusDE = "Ausstehend";
        if (overallStatus === "approved") statusDE = "Genehmigt";
        if (overallStatus === "rejected") statusDE = "Abgelehnt";

        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: user.id,
            body: `Dein Urlaubsantrag wurde bearbeitet. Status: ${statusDE}.`,
          },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      }

      return { ok: true };
    }, { maxWait: 5000, timeout: 30000 });

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
        days: { select: { date: true } },
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

    const dates = request.days.map((d) => d.date.getTime()).sort((a, b) => a - b);
    const startDate = dates.length ? new Date(dates[0]) : new Date();
    const endDate = dates.length ? new Date(dates[dates.length - 1]) : new Date();

    const cancelHtml = `
      <p>Ihr Urlaub wurde von der Verwaltung storniert.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; font-family: sans-serif; font-size: 14px;">
        <thead>
          <tr style="background-color: #f3f4f6; text-align: left;">
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Mitarbeiter</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Von</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb;">Bis</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${request.worker.fullName}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${dates.length ? formatDateDE(startDate) : '-'}</td>
            <td style="padding: 10px; border: 1px solid #e5e7eb;">${dates.length ? formatDateDE(endDate) : '-'}</td>
          </tr>
        </tbody>
      </table>
    `;

    await pushToUsers([request.worker.userId], {
      title: "Urlaub storniert",
      body: "Ihr Urlaub wurde von der Verwaltung storniert.",
      url: workerShiftLink(),
      htmlBody: cancelHtml,
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

export async function addLeaveByAdmin(
  workerId: string,
  type: "vacation" | "sick" | "other",
  dates: string[],
  hoursPerDay: number
) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin", "super_admin"])) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { userId: true },
    });
    if (!worker) return { ok: false, error: "not_found" };

    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.leaveRequest.create({
        data: {
          workerId: workerId,
          type: type,
          status: "approved",
          days: {
            create: dates.map((date) => ({
              date: new Date(date + "T00:00:00Z"),
              status: "approved",
              hours: hoursPerDay,
            })),
          },
        },
      });

      // No conversation needed for admin-added leave, but we can notify the worker
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "order_status_changed", // Reusing this type
          channel: "in_app",
          content: type === "sick" ? "Krankheitstag(e) wurden eingetragen." : "Urlaub wurde eingetragen.",
          link: workerShiftLink(),
        },
      });
      
      return request;
    });

    await audit({
      userId: user.id,
      action: "leave.addByAdmin",
      entity: "LeaveRequest",
      entityId: result.id,
      metadata: { workerId, type, dates: dates.join(","), hoursPerDay },
    });

    return { ok: true };
  } catch (error) {
    console.error("Failed to add leave:", error);
    return { ok: false, error: "Failed to add leave" };
  }
}
