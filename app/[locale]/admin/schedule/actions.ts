"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { lettersToBlocks, SHIFT_PRESETS, type ShiftKey } from "@/lib/master-schedule-core";
import { candidatesForShift, type Candidate } from "@/lib/orders";
import { offerAssignment } from "@/lib/assignments";
import { qualifications } from "@/lib/validations";
import { formatDateDE } from "@/lib/utils";
import { orderLink, workerShiftLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import type { Qualification } from "@prisma/client";

// Cell-level edits on the master schedule grid. Every edit here mutates the
// SAME entities the order/availability pages use (WorkerAvailability, Order,
// Assignment) inside one transaction — the grid is a view, never a copy.

export type ActionState = { ok: boolean; error?: string };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const lettersSchema = z.string().regex(/^(OFF|(?!.*(.).*\1)[FSN]{0,3})$/); // subset of F,S,N, no repeats
const shiftKeySchema = z.enum(["early", "late", "night"]);

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
// Same-day overlap; open-ended (overnight) ranges are clamped to midnight.
const overlaps = (aS: string, aE: string, bS: string, bE: string) => {
  const ae = toMin(aE) <= toMin(aS) ? 24 * 60 : toMin(aE);
  const be = toMin(bE) <= toMin(bS) ? 24 * 60 : toMin(bE);
  return toMin(aS) < be && toMin(bS) < ae;
};

// Top line of a cell: replace one worker-day's availability. `letters` are the
// AVAILABLE shift windows (e.g. "FSN" fully available, "" whole day off).
export async function saveDayAvailabilityFromGrid(
  workerId: string,
  date: string,
  letters: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!dateSchema.safeParse(date).success || !lettersSchema.safeParse(letters).success) {
    return { ok: false, error: "saveError" };
  }

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true },
  });
  if (!worker) return { ok: false, error: "saveError" };

  const day = new Date(`${date}T00:00:00.000Z`);
  // Positive availability: the letters are the declared-available windows.
  // Empty selection clears the day (undeclared → not available).
  let dbBlocks: { startTime: string | null; endTime: string | null; status: "available" | "unavailable" }[] = [];
  if (letters === "OFF") {
    dbBlocks = [{ startTime: null, endTime: null, status: "unavailable" }];
  } else {
    dbBlocks = lettersToBlocks(letters).map(b => ({ ...b, status: "available" }));
  }

  await prisma.$transaction([
    prisma.workerAvailability.deleteMany({ where: { workerId, date: day } }),
    ...(dbBlocks.length
      ? [
          prisma.workerAvailability.createMany({
            data: dbBlocks.map((b) => ({
              workerId,
              date: day,
              status: b.status,
              startTime: b.startTime,
              endTime: b.endTime,
            })),
          }),
        ]
      : []),
  ]);

  await audit({
    userId: admin.id,
    action: "availability.save",
    entity: "Worker",
    entityId: workerId,
    metadata: { date, letters, via: "master-schedule" },
  });

  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath("/worker");
  return { ok: true };
}

// Bottom line of a cell: put a worker on a shift at a facility. Reuses an
// existing open order for that facility/day/window when one still has free
// headcount; otherwise creates a single-shift admin order. Conflicts
// (overlapping assignment, marked unavailable) are rejected unless the admin
// explicitly overrides — same philosophy as the candidate list.
export async function assignFromGrid(input: {
  workerId: string;
  date: string;
  shift: ShiftKey;
  clientId: string;
  ward?: string;
  force?: boolean;
}): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = z
    .object({
      workerId: z.string().uuid(),
      date: dateSchema,
      shift: shiftKeySchema,
      clientId: z.string().uuid(),
      ward: z.string().max(120).optional(),
      force: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { workerId, date, shift, clientId, ward, force } = parsed.data;

  const preset = SHIFT_PRESETS[shift];
  const day = new Date(`${date}T00:00:00.000Z`);

  const [worker, client] = await Promise.all([
    prisma.worker.findUnique({
      where: { id: workerId },
      select: {
        id: true,
        userId: true,
        qualification: true,
        availability: {
          where: { date: day, status: "available" },
          select: { startTime: true, endTime: true },
        },
        assignments: {
          where: { status: { not: "declined" }, order: { shiftDate: day, status: { not: "cancelled" } } },
          select: { order: { select: { startTime: true, endTime: true } } },
        },
      },
    }),
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, facilityName: true },
    }),
  ]);
  if (!worker || !client) return { ok: false, error: "saveError" };

  if (!force) {
    const busy = worker.assignments.some((a) =>
      overlaps(a.order.startTime, a.order.endTime, preset.start, preset.end),
    );
    if (busy) return { ok: false, error: "busy" };
    // Positive availability: assignable only if the worker declared this window.
    const declared = worker.availability.some(
      (b) =>
        (b.startTime === null && b.endTime === null) ||
        (b.startTime !== null &&
          b.endTime !== null &&
          overlaps(b.startTime, b.endTime, preset.start, preset.end)),
    );
    if (!declared) return { ok: false, error: "unavailable" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Attach to an open matching order first so grid assignments fill real
      // client requests instead of duplicating them.
      const candidates = await tx.order.findMany({
        where: {
          clientId,
          shiftDate: day,
          requiredQualification: worker.qualification,
          startTime: preset.start,
          endTime: preset.end,
          status: { in: ["pending", "review", "availability_check", "assigned", "accepted"] },
        },
        select: {
          id: true,
          quantity: true,
          status: true,
          assignments: { where: { status: { not: "declined" } }, select: { id: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      const open = candidates.find((o) => o.assignments.length < o.quantity);

      let orderId: string;
      if (open) {
        orderId = open.id;
        if (["pending", "review", "availability_check"].includes(open.status)) {
          await tx.order.update({ where: { id: open.id }, data: { status: "assigned" } });
        }
      } else {
        const created = await tx.order.create({
          data: {
            clientId,
            requestGroupId: crypto.randomUUID(),
            requiredQualification: worker.qualification,
            shiftDate: day,
            startTime: preset.start,
            endTime: preset.end,
            quantity: 1,
            notes: ward || null,
            status: "assigned",
          },
          select: { id: true },
        });
        orderId = created.id;
      }

      // Resurrects a prior decline instead of failing on the unique key.
      await offerAssignment(tx, orderId, workerId);
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "worker_assigned",
          channel: "in_app",
          content: `${formatDateDE(day)} ${preset.start}–${preset.end} · ${client.facilityName}`,
          link: workerShiftLink(),
        },
      });
    });
  } catch {
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "assignment.create",
    entity: "Worker",
    entityId: workerId,
    metadata: { date, shift, clientId, via: "master-schedule", forced: !!force },
  });

  await pushToUsers([worker.userId], {
    title: "Neuer Einsatz",
    body: `${formatDateDE(day)} ${preset.start}–${preset.end} · ${client.facilityName}`,
    url: workerShiftLink(),
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath("/worker");
  return { ok: true };
}

// Create a new OPEN requested shift straight from the grey "offene Dienste"
// section — the admin fills a client request directly on the sheet (no worker
// yet). It becomes a real Order (status pending) that shows in /admin/orders and
// as an open shift in the grey section, ready to be staffed. The facility's user
// is notified an order was placed on their account.
export async function createOpenOrderFromGrid(input: {
  clientId: string;
  date: string;
  shift: ShiftKey;
  qualification: Qualification;
  ward?: string;
  quantity?: number;
}): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const parsed = z
    .object({
      clientId: z.string().uuid(),
      date: dateSchema,
      shift: shiftKeySchema,
      qualification: z.enum(qualifications),
      ward: z.string().max(120).optional(),
      quantity: z.coerce.number().int().min(1).max(50).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { clientId, date, shift, qualification, ward, quantity } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, userId: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const preset = SHIFT_PRESETS[shift];
  const day = new Date(`${date}T00:00:00.000Z`);

  const newRequestGroupId = crypto.randomUUID();
  await prisma.order.create({
    data: {
      clientId,
      requestGroupId: newRequestGroupId,
      requiredQualification: qualification,
      shiftDate: day,
      startTime: preset.start,
      endTime: preset.end,
      quantity: quantity ?? 1,
      notes: ward || null,
      status: "pending",
    },
  });

  if (client.userId) {
    await prisma.notification.create({
      data: {
        userId: client.userId,
        type: "new_order",
        channel: "in_app",
        content: `${formatDateDE(day)} ${preset.start}–${preset.end} · ${client.facilityName}`,
        link: orderLink("client", newRequestGroupId),
      },
    });
    await pushToUsers([client.userId], {
      title: "Neue Anfrage",
      body: `${formatDateDE(day)} ${preset.start}–${preset.end} · ${client.facilityName}`,
      url: orderLink("client", newRequestGroupId),
    });
  }

  await audit({
    userId: admin.id,
    action: "order.request.create",
    entity: "Order",
    entityId: clientId,
    metadata: { date, shift, qualification, quantity: quantity ?? 1, via: "master-schedule" },
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath("/client/orders");
  return { ok: true };
}

// Qualified candidates for an open requested shift (grey section) — each
// flagged available / busy / unavailable so the admin can pick with context.
export async function candidatesForOrder(
  orderId: string,
): Promise<{ ok: true; candidates: Candidate[] } | { ok: false; error: string }> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!z.string().uuid().safeParse(orderId).success) {
    return { ok: false, error: "saveError" };
  }
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
    },
  });
  if (!order) return { ok: false, error: "saveError" };
  const candidates = await candidatesForShift(order);
  return { ok: true, candidates };
}

// Assign a worker to an EXISTING requested shift from the grey section. Same
// conflict rules as the cell editor: busy/unavailable are rejected unless the
// admin forces the override.
export async function assignWorkerToOrder(
  orderId: string,
  workerId: string,
  force = false,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (
    !z.string().uuid().safeParse(orderId).success ||
    !z.string().uuid().safeParse(workerId).success
  ) {
    return { ok: false, error: "saveError" };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      client: { select: { facilityName: true } },
    },
  });
  if (!order) return { ok: false, error: "saveError" };

  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: {
      userId: true,
      availability: {
        where: { date: order.shiftDate, status: "available" },
        select: { startTime: true, endTime: true },
      },
      assignments: {
        where: { status: { not: "declined" }, order: { shiftDate: order.shiftDate } },
        select: { orderId: true, order: { select: { startTime: true, endTime: true } } },
      },
    },
  });
  if (!worker) return { ok: false, error: "saveError" };
  if (worker.assignments.some((a) => a.orderId === order.id)) {
    return { ok: false, error: "saveError" }; // already on this shift
  }

  if (!force) {
    const busy = worker.assignments.some((a) =>
      overlaps(a.order.startTime, a.order.endTime, order.startTime, order.endTime),
    );
    if (busy) return { ok: false, error: "busy" };
    // Positive availability: assignable only if the worker declared this window.
    const declared = worker.availability.some(
      (b) =>
        (b.startTime === null && b.endTime === null) ||
        (b.startTime !== null &&
          b.endTime !== null &&
          overlaps(b.startTime, b.endTime, order.startTime, order.endTime)),
    );
    if (!declared) return { ok: false, error: "unavailable" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await offerAssignment(tx, orderId, workerId);
      if (["pending", "review", "availability_check"].includes(order.status)) {
        await tx.order.update({ where: { id: orderId }, data: { status: "assigned" } });
      }
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "worker_assigned",
          channel: "in_app",
          content: `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime} · ${order.client.facilityName}`,
          link: workerShiftLink(),
        },
      });
    });
  } catch {
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "assignment.create",
    entity: "Order",
    entityId: orderId,
    metadata: { workerId, via: "master-schedule-unassigned", forced: force },
  });

  await pushToUsers([worker.userId], {
    title: "Neuer Einsatz",
    body: `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime} · ${order.client.facilityName}`,
    url: workerShiftLink(),
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath("/worker");
  return { ok: true };
}

// Shared release: delete the assignment and, if the order is left with no other
// workers, fall it back to "pending" so it re-enters the pipeline and shows in
// the grey "offene Dienste" pool (never deleted — the client still expects it).
// A signed Leistungsnachweis makes the deployment a legal record → never removed.
async function releaseAssignmentCore(
  assignmentId: string,
  adminId: string,
  notice: { title: string; body: string },
  via: string,
): Promise<ActionState> {
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return { ok: false, error: "saveError" };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      workerId: true,
      serviceConfirmation: { select: { id: true } },
      worker: { select: { userId: true } },
      order: {
        select: {
          id: true,
          status: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
          assignments: { where: { status: { not: "declined" } }, select: { id: true } },
        },
      },
    },
  });
  if (!assignment) return { ok: false, error: "saveError" };
  if (assignment.serviceConfirmation) return { ok: false, error: "confirmed" };

  const others = assignment.order.assignments.filter((a) => a.id !== assignment.id);

  await prisma.$transaction(async (tx) => {
    await tx.assignment.delete({ where: { id: assignment.id } });
    if (others.length === 0 && !["completed", "confirmed", "cancelled"].includes(assignment.order.status)) {
      await tx.order.update({ where: { id: assignment.order.id }, data: { status: "pending" } });
    }
    await tx.notification.create({
      data: {
        userId: assignment.worker.userId,
        type: "order_status_changed",
        channel: "in_app",
        content: notice.body,
        link: workerShiftLink(),
      },
    });
  });

  await pushToUsers([assignment.worker.userId], {
    title: notice.title,
    body: notice.body,
    url: workerShiftLink(),
  });

  await audit({
    userId: adminId,
    action: "assignment.delete",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { workerId: assignment.workerId, via },
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  revalidatePath("/worker");
  return { ok: true };
}

// Remove a grid assignment (cell trash button). Releases the shift to the grey
// pool for reassignment.
export async function unassignFromGrid(assignmentId: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      order: {
        select: {
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
        },
      },
    },
  });
  const body = a
    ? `${formatDateDE(a.order.shiftDate)} ${a.order.startTime}–${a.order.endTime} · ${a.order.client.facilityName}`
    : "Einsatz freigegeben";
  return releaseAssignmentCore(
    assignmentId,
    admin.id,
    { title: "Einsatz freigegeben", body },
    "master-schedule",
  );
}

// Admin releases a worker from a shift on purpose (full authority) — same effect
// as unassign; used from the worker hours page.
export async function releaseAssignment(assignmentId: string): Promise<ActionState> {
  return unassignFromGrid(assignmentId);
}

// Admin APPROVES a worker's cancellation request → release the shift to grey.
export async function approveShiftCancellation(assignmentId: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      order: {
        select: {
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
        },
      },
    },
  });
  const label = a
    ? `${formatDateDE(a.order.shiftDate)} ${a.order.startTime}–${a.order.endTime} · ${a.order.client.facilityName}`
    : "";
  return releaseAssignmentCore(
    assignmentId,
    admin.id,
    { title: "Abmeldung genehmigt", body: `Abmeldung genehmigt – ${label}` },
    "cancel-approve",
  );
}

// Admin REJECTS a cancellation request → clear the flags, worker stays on the
// shift and is told the request was declined.
export async function rejectShiftCancellation(assignmentId: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return { ok: false, error: "saveError" };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      workerId: true,
      worker: { select: { userId: true } },
      order: {
        select: {
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { facilityName: true } },
        },
      },
    },
  });
  if (!assignment) return { ok: false, error: "saveError" };

  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { cancelRequested: false, cancelNote: null, cancelRequestedAt: null },
  });

  const body = `Abmeldung abgelehnt – ${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime} · ${assignment.order.client.facilityName}`;
  await prisma.notification.create({
    data: {
      userId: assignment.worker.userId,
      type: "order_status_changed",
      channel: "in_app",
      content: body,
      link: workerShiftLink(),
    },
  });
  await pushToUsers([assignment.worker.userId], {
    title: "Abmeldung abgelehnt",
    body,
    url: workerShiftLink(),
  });

  await audit({
    userId: admin.id,
    action: "assignment.cancelReject",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { workerId: assignment.workerId },
  });

  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
  revalidatePath("/worker");
  return { ok: true };
}
