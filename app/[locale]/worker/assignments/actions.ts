"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { runSerializable } from "@/lib/assignments";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { orderLink, inboxLink, workerShiftLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import { formatDateDE } from "@/lib/utils";

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

  // Workers whose pending offer is withdrawn because the shift filled up — the
  // shift disappears from their portal; we let them know afterwards.
  let withdrawnUserIds: string[] = [];

  try {
    // SERIALIZABLE: the "confirmed ≤ quantity" invariant is checked-then-written,
    // so two workers racing for the last slot must not both pass the count. The
    // DB serialises them and we retry the loser (→ it sees the shift is full).
    // Accepting is allowed from a `declined` state too, so a worker (or the
    // office on their behalf) can reverse a shift they turned down by mistake.
    await runSerializable(async (tx) => {
      if (accept) {
        const orderData = await tx.order.findUnique({
          where: { id: assignment.order.id },
          select: {
            quantity: true,
            _count: {
              select: {
                assignments: {
                  where: { status: "confirmed", NOT: { id: assignmentId } },
                },
              },
            },
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
          // Re-accepting clears any stale withdrawal request on the row.
          ...(accept
            ? { cancelRequested: false, cancelNote: null, cancelRequestedAt: null }
            : {}),
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
        const label = `${assignment.order.shiftDate
          .toISOString()
          .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`;
        if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map((r) => ({
              userId: r.id,
              type: "worker_confirmed" as const,
              channel: "in_app" as const,
              content: `${assignment.worker.fullName}: ${label}`,
              link: orderLink(r.role, reqGroup),
            })),
          });
        }

        // Once the headcount is met, the shift is off the market: withdraw every
        // remaining pending offer so it disappears from the other workers'
        // portals (a shift can't be double-booked past its quantity).
        const staffing = await tx.order.findUnique({
          where: { id: assignment.order.id },
          select: {
            quantity: true,
            _count: { select: { assignments: { where: { status: "confirmed" } } } },
          },
        });
        if (staffing && staffing._count.assignments >= staffing.quantity) {
          const stillPending = await tx.assignment.findMany({
            where: {
              orderId: assignment.order.id,
              status: "pending",
              NOT: { id: assignmentId },
            },
            select: { id: true, worker: { select: { userId: true } } },
          });
          if (stillPending.length) {
            await tx.assignment.deleteMany({
              where: { id: { in: stillPending.map((a) => a.id) } },
            });
            withdrawnUserIds = stillPending.map((a) => a.worker.userId);
            await tx.notification.createMany({
              data: withdrawnUserIds.map((uid) => ({
                userId: uid,
                type: "order_status_changed" as const,
                channel: "in_app" as const,
                content: `Einsatz bereits besetzt: ${label}`,
                link: workerShiftLink(),
              })),
            });
          }
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
      // Tell the workers who lost the offer that it's been filled.
      withdrawnUserIds.length
        ? pushToUsers(withdrawnUserIds, {
            title: "Einsatz bereits besetzt",
            body: `${assignment.order.shiftDate
              .toISOString()
              .slice(0, 10)} ${assignment.order.startTime}–${assignment.order.endTime}`,
            url: workerShiftLink(),
          })
        : Promise.resolve(),
    ]);
  }

  revalidatePath("/worker");
  revalidatePath(`/admin/orders/${assignment.order.id}`);
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  return { ok: true };
}

// The worker asks the office to be taken off a shift they already accepted,
// with a note explaining why. This does NOT release the shift — it flags a
// pending request the admin approves (→ released to the grey pool) or rejects.
// The note reaches the office as an inbox message + notification + push, and the
// shift shows "awaiting reply" in the schedule and the admin hours page.
export async function requestShiftCancellation(
  assignmentId: string,
  note: string,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "worker") return { ok: false, error: "forbidden" };

  const parsedNote = z.string().trim().max(1000).safeParse(note);
  if (!parsedNote.success) return { ok: false, error: "saveError" };

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      worker: { select: { userId: true, fullName: true } },
      serviceConfirmation: { select: { id: true } },
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
        },
      },
    },
  });
  if (!assignment || assignment.worker.userId !== user.id) {
    return { ok: false, error: "forbidden" };
  }
  // Signed shifts are a legal record — can't be cancelled here.
  if (assignment.serviceConfirmation) return { ok: false, error: "confirmed" };
  if (assignment.status === "declined") return { ok: false, error: "saveError" };

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: {
      cancelRequested: true,
      cancelNote: parsedNote.data || null,
      cancelRequestedAt: new Date(),
    },
  });

  const label = `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime}`;
  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const summary = `${assignment.worker.fullName}: Abmeldung angefragt – ${label}`;

  const admins = await prisma.user.findMany({
    where: { role: { in: ["admin", "super_admin"] }, active: true },
    select: { id: true },
  });

  // In-app notification to every admin (deep-links to the order request).
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "order_status_changed" as const,
        channel: "in_app" as const,
        content: summary,
        link: orderLink("admin", reqGroup),
      })),
    });
  }

  // The note lands in the assignment's inbox thread so the office can reply.
  const { getOrCreateAssignmentConversation } = await import("@/lib/inbox");
  const conversation = await getOrCreateAssignmentConversation(assignmentId);
  const body = parsedNote.data
    ? `Abmeldung angefragt (${label}): ${parsedNote.data}`
    : `Abmeldung angefragt (${label}).`;
  const now = new Date();
  if (conversation) {
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: conversation.id, senderId: user.id, body },
      }),
      prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now },
      }),
      prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId: user.id },
        },
        data: { lastReadAt: now },
      }),
    ]);
  }

  await pushToUsers(
    admins.map((a) => a.id),
    {
      title: "Abmeldung angefragt",
      body: summary,
      url: conversation ? inboxLink("admin", conversation.id) : orderLink("admin", reqGroup),
    },
  );

  await audit({
    userId: user.id,
    action: "assignment.cancelRequest",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { hasNote: Boolean(parsedNote.data) },
  });

  revalidatePath("/worker");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  revalidatePath(`/admin/orders/${reqGroup}`);
  return { ok: true };
}
