"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";

export type ActionState = { ok: boolean; error?: string };

// Worker accepts or declines an assignment they own. Admins may respond on
// the worker's behalf (e.g. acceptance given by phone) — the audit log keeps
// the acting user, so on-behalf responses stay traceable.
export async function respondAssignment(
  assignmentId: string,
  accept: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  if (!user || (!isStaff && user.role !== "worker")) {
    return { ok: false, error: "forbidden" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { select: { userId: true, fullName: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { userId: true } },
        },
      },
    },
  });
  if (!assignment || (!isStaff && assignment.worker.userId !== user.id)) {
    return { ok: false, error: "forbidden" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (accept) {
        const orderData = await tx.order.findUnique({
          where: { id: assignment.order.id },
          select: {
            quantity: true,
            _count: { select: { assignments: { where: { status: "confirmed" } } } },
          },
        });
        if (!orderData || orderData._count.assignments >= orderData.quantity) {
          throw new Error("shiftFull");
        }
      }

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
        const recipients = await tx.user.findMany({
          where: {
            OR: [
              { id: assignment.order.client.userId },
              { role: { in: ["admin", "super_admin"] }, active: true },
            ],
          },
          select: { id: true, role: true },
        });
        const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
        if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map((r) => ({
              userId: r.id,
              type: "worker_confirmed" as const,
              channel: "in_app" as const,
              content: `${assignment.worker.fullName}: ${assignment.order.shiftDate
                .toISOString()
                .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`,
              link: orderLink(r.role, reqGroup),
            })),
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "shiftFull") {
      return { ok: false, error: "shiftFull" };
    }
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: user.id,
    action: accept ? "assignment.confirm" : "assignment.decline",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { actorRole: user.role },
  });

  // Mobile push to the office + client when the worker accepts.
  if (accept) {
    const body = `${assignment.worker.fullName}: ${assignment.order.shiftDate
      .toISOString()
      .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`;
    const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
    const admins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, active: true },
      select: { id: true },
    });
    const clientUserId = assignment.order.client.userId;
    await Promise.all([
      clientUserId
        ? pushToUsers([clientUserId], {
            title: "Einsatz bestätigt",
            body,
            url: orderLink("client", reqGroup),
          })
        : Promise.resolve(),
      pushToUsers(
        admins.map((a) => a.id),
        { title: "Einsatz bestätigt", body, url: orderLink("admin", reqGroup) },
      ),
    ]);
  }

  revalidatePath("/worker");
  revalidatePath(`/admin/orders/${assignment.order.id}`);
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  return { ok: true };
}
