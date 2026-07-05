"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import {
  orderStatuses,
  orderRequestSchema,
  type OrderRequestInput,
} from "@/lib/validations";
import {
  diffRequestShifts,
  isRequestCancelable,
  candidatesForOrders,
  type BulkCandidate,
  type BulkShift,
} from "@/lib/orders";
import { formatDateDE } from "@/lib/utils";
import { orderLink, workerShiftLink } from "@/lib/notify";
import { pushToUsers } from "@/lib/push";
import type { OrderStatus, Qualification } from "@prisma/client";

export type ActionState = { ok: boolean; error?: string };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

// Admin-created calendar request on behalf of a chosen client. Mirrors the
// client-side createOrderRequest but the admin selects the target client, and
// the client's user is notified that an order was added to their account.
export async function createOrderRequestForClient(
  clientId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, userId: true, facilityName: true },
  });
  if (!client) return { ok: false, error: "saveError" };

  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { notes, shifts } = parsed.data;

  const requestGroupId = crypto.randomUUID();

  await prisma.order.createMany({
    data: shifts.map((s) => ({
      clientId: client.id,
      requestGroupId,
      requiredQualification: s.requiredQualification,
      shiftDate: new Date(`${s.date}T00:00:00.000Z`),
      startTime: s.startTime,
      endTime: s.endTime,
      quantity: s.quantity,
      notes: s.bereich ?? notes ?? null,
      status: "pending" as const,
    })),
  });

  // Let the client know an order was created on their account.
  if (client.userId) {
    await prisma.notification.create({
      data: {
        userId: client.userId,
        type: "new_order",
        channel: "in_app",
        content: `${client.facilityName}: ${shifts.length} Schicht(en)`,
        link: orderLink("client", requestGroupId),
      },
    });
    await pushToUsers([client.userId], {
      title: "Neue Anfrage",
      body: `${client.facilityName}: ${shifts.length} Schicht(en)`,
      url: orderLink("client", requestGroupId),
    });
  }

  await audit({
    userId: admin.id,
    action: "order.request.create",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { shifts: shifts.length, clientId },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/client/orders");
  return { ok: true };
}

// Admin adjusting a request: apply only the actual changes. Admins are not
// bound to the client's 4h cutoff — they may edit at any time, even after a
// shift has run. Untouched shifts keep their orders, assignments and
// confirmations; only modified/removed shifts are replaced.
export async function updateOrderRequestAsAdmin(
  requestGroupId: string,
  input: OrderRequestInput,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const existing = await prisma.order.findMany({
    where: { requestGroupId },
    select: {
      id: true,
      clientId: true,
      status: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      quantity: true,
      notes: true,
      requiredQualification: true,
    },
  });
  if (existing.length === 0) return { ok: false, error: "saveError" };
  const clientId = existing[0].clientId;

  const parsed = orderRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "saveError" };
  const { notes, shifts } = parsed.data;

  const { updates, creates, deleteIds } = diffRequestShifts(
    existing,
    shifts.map((s) => ({
      date: s.date,
      requiredQualification: s.requiredQualification,
      startTime: s.startTime,
      endTime: s.endTime,
      quantity: s.quantity,
      notes: s.bereich ?? notes ?? null,
    })),
  );

  if (updates.length + creates.length + deleteIds.length > 0) {
    await prisma.$transaction([
      ...(deleteIds.length
        ? [prisma.order.deleteMany({ where: { id: { in: deleteIds } } })]
        : []),
      ...updates.map((u) =>
        prisma.order.update({
          where: { id: u.id },
          data: { quantity: u.quantity, notes: u.notes },
        }),
      ),
      ...(creates.length
        ? [
            prisma.order.createMany({
              data: creates.map((s) => ({
                clientId,
                requestGroupId,
                requiredQualification: s.requiredQualification as Qualification,
                shiftDate: new Date(`${s.date}T00:00:00.000Z`),
                startTime: s.startTime,
                endTime: s.endTime,
                quantity: s.quantity,
                notes: s.notes,
                status: "pending" as const,
              })),
            }),
          ]
        : []),
    ]);
  }

  await audit({
    userId: admin.id,
    action: "order.request.update",
    entity: "Order",
    entityId: requestGroupId,
    metadata: {
      byAdmin: true,
      updated: updates.length,
      created: creates.length,
      deleted: deleteIds.length,
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${requestGroupId}`);
  revalidatePath("/client/orders");
  return { ok: true };
}

// Admin cancelling a whole request (all shifts sharing the requestGroupId) — a
// SOFT cancel: the records stay in the database (status → cancelled), nothing is
// deleted. Admins are not bound to the client's cutoff, but a request whose
// shifts already ran/were confirmed cannot be cancelled. The client is notified
// that the request was cancelled on their account.
export async function cancelOrderRequestAsAdmin(
  requestGroupId: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const existing = await prisma.order.findMany({
    where: { requestGroupId },
    select: { id: true, clientId: true, status: true },
  });
  if (existing.length === 0) return { ok: false, error: "saveError" };
  if (!isRequestCancelable(existing)) return { ok: false, error: "locked" };

  const client = await prisma.client.findUnique({
    where: { id: existing[0].clientId },
    select: { userId: true, facilityName: true },
  });

  await prisma.order.updateMany({
    where: { requestGroupId, status: { not: "cancelled" } },
    data: { status: "cancelled" },
  });

  if (client?.userId) {
    await prisma.notification.create({
      data: {
        userId: client.userId,
        type: "order_status_changed",
        channel: "in_app",
        content: `${client.facilityName}: Anfrage storniert – ${existing.length} Schicht(en)`,
        link: orderLink("client", requestGroupId),
      },
    });
  }

  await audit({
    userId: admin.id,
    action: "order.request.cancel",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { byAdmin: true, shifts: existing.length },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${requestGroupId}`);
  revalidatePath("/client/orders");
  return { ok: true };
}

export async function updateOrderStatus(
  orderId: string,
  status: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!(orderStatuses as readonly string[]).includes(status)) {
    return { ok: false, error: "saveError" };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: status as OrderStatus },
  });

  await audit({
    userId: admin.id,
    action: "order.status",
    entity: "Order",
    entityId: orderId,
    metadata: { status },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

// Assign a worker to an order, notify them, and advance the order to "assigned".
export async function assignWorker(
  orderId: string,
  workerId: string,
): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const [order, worker] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, shiftDate: true, startTime: true, endTime: true },
    }),
    prisma.worker.findUnique({
      where: { id: workerId },
      select: { userId: true },
    }),
  ]);
  if (!order || !worker) return { ok: false, error: "saveError" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.assignment.create({
        data: { orderId, workerId, status: "pending" },
      });
      // Advance the pipeline once the first worker is assigned.
      if (["pending", "review", "availability_check"].includes(order.status)) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "assigned" },
        });
      }
      // In-app notification to the worker (CLAUDE.md §8 "Worker assigned").
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "worker_assigned",
          channel: "in_app",
          content: `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime}`,
          link: workerShiftLink(),
        },
      });
    });
  } catch {
    // Unique (orderId, workerId) — already assigned, treat as a soft failure.
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "assignment.create",
    entity: "Order",
    entityId: orderId,
    metadata: { workerId },
  });

  await pushToUsers([worker.userId], {
    title: "Neuer Einsatz",
    body: `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime}`,
    url: workerShiftLink(),
  });

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}

// Load the workers eligible for a set of selected shifts, with per-worker
// availability counts, so the bulk-assign dialog can offer several shifts to
// several workers at once. Admin-only.
export async function getBulkCandidates(orderIds: string[]): Promise<
  { ok: true; shifts: BulkShift[]; candidates: BulkCandidate[] } | { ok: false; error: string }
> {
  try {
    await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { ok: false, error: "saveError" };
  }
  const { shifts, candidates } = await candidatesForOrders(orderIds);
  return { ok: true, shifts, candidates };
}

// Bulk "offer to all": create a pending assignment for every selected worker on
// every selected shift they qualify for. Conflicting shifts (worker booked
// elsewhere = busy, or not declared available = unavailable) are skipped unless
// `force` is set. Already-assigned pairs and fully-confirmed shifts are skipped.
// Each new assignment notifies the worker; workers accept/decline and the
// shift's headcount caps acceptance (respondAssignment). Returns how many
// offers were created vs skipped.
export async function bulkAssignWorkers(
  orderIds: string[],
  workerIds: string[],
  force: boolean,
): Promise<ActionState & { created?: number; skipped?: number }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (
    !Array.isArray(orderIds) ||
    !Array.isArray(workerIds) ||
    orderIds.length === 0 ||
    workerIds.length === 0
  ) {
    return { ok: false, error: "saveError" };
  }

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const overlaps = (bs: string, be: string, s: string, e: string) =>
    toMin(bs) < toMin(e) && toMin(s) < toMin(be);
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      status: true,
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
      quantity: true,
      assignments: { select: { workerId: true, status: true } },
    },
  });
  if (orders.length === 0) return { ok: false, error: "saveError" };

  const dates = [
    ...new Map(orders.map((o) => [o.shiftDate.getTime(), o.shiftDate])).values(),
  ];

  // Everything needed to judge each worker × shift in ONE query: their declared
  // availability and existing bookings on the relevant days. Conflicts are then
  // resolved in memory (no per-shift candidate query → no N+1).
  const workers = await prisma.worker.findMany({
    where: { id: { in: workerIds }, user: { active: true } },
    select: {
      id: true,
      userId: true,
      qualification: true,
      availability: {
        where: { date: { in: dates }, status: "available" },
        select: { date: true, startTime: true, endTime: true },
      },
      assignments: {
        where: { status: { not: "declined" }, order: { shiftDate: { in: dates } } },
        select: { orderId: true, order: { select: { shiftDate: true } } },
      },
    },
  });
  const workerById = new Map(workers.map((w) => [w.id, w]));

  const offers: { orderId: string; workerId: string; userId: string; content: string }[] = [];
  const advanceIds: string[] = [];
  let skipped = 0;

  for (const order of orders) {
    const confirmed = order.assignments.filter((a) => a.status === "confirmed").length;
    // No point offering a cancelled or already-fully-confirmed shift.
    if (order.status === "cancelled" || confirmed >= order.quantity) {
      skipped += workerIds.length;
      continue;
    }
    const alreadyOn = new Set(
      order.assignments.filter((a) => a.status !== "declined").map((a) => a.workerId),
    );
    const key = dayKey(order.shiftDate);
    const content = `${formatDateDE(order.shiftDate)} ${order.startTime}–${order.endTime}`;

    let addedForOrder = 0;
    for (const wid of workerIds) {
      const w = workerById.get(wid);
      if (!w || w.qualification !== order.requiredQualification || alreadyOn.has(wid)) {
        skipped += 1;
        continue;
      }
      // Mirror candidatesForShift: worker must have declared availability for the
      // window; "busy" = any other non-declined booking the same day.
      const declared = w.availability.some(
        (a) =>
          dayKey(a.date) === key &&
          ((a.startTime === null && a.endTime === null) ||
            (a.startTime !== null &&
              a.endTime !== null &&
              overlaps(a.startTime, a.endTime, order.startTime, order.endTime))),
      );
      const busy = w.assignments.some(
        (a) => a.orderId !== order.id && dayKey(a.order.shiftDate) === key,
      );
      if (!(declared && !busy) && !force) {
        skipped += 1;
        continue;
      }
      offers.push({ orderId: order.id, workerId: wid, userId: w.userId, content });
      addedForOrder += 1;
    }
    if (
      addedForOrder > 0 &&
      ["pending", "review", "availability_check"].includes(order.status)
    ) {
      advanceIds.push(order.id);
    }
  }

  if (offers.length === 0) return { ok: true, created: 0, skipped };

  // Bulk writes: a handful of queries no matter how many offers — avoids the
  // long interactive transaction that hit Prisma's 5s timeout and rolled the
  // whole thing back on "select all × many workers".
  const createdRes = await prisma.assignment.createMany({
    data: offers.map((o) => ({
      orderId: o.orderId,
      workerId: o.workerId,
      status: "pending" as const,
    })),
    skipDuplicates: true, // a prior declined offer for the same pair stays put
  });
  await prisma.notification.createMany({
    data: offers.map((o) => ({
      userId: o.userId,
      type: "worker_assigned" as const,
      channel: "in_app" as const,
      content: o.content,
      link: workerShiftLink(),
    })),
  });
  if (advanceIds.length) {
    await prisma.order.updateMany({
      where: { id: { in: advanceIds } },
      data: { status: "assigned" },
    });
  }
  const created = createdRes.count;

  await audit({
    userId: admin.id,
    action: "assignment.bulkCreate",
    entity: "Order",
    entityId: orderIds[0],
    metadata: {
      orders: orderIds.length,
      workers: workerIds.length,
      created,
      skipped,
      force,
    },
  });

  // One push per worker summarising how many shifts they were offered.
  const perWorker = new Map<string, number>();
  for (const o of offers) perWorker.set(o.userId, (perWorker.get(o.userId) ?? 0) + 1);
  await Promise.all(
    [...perWorker].map(([userId, n]) =>
      pushToUsers([userId], {
        title: "Neue Einsätze",
        body: n === 1 ? offers.find((o) => o.userId === userId)!.content : `${n} neue Schicht(en)`,
        url: workerShiftLink(),
      }),
    ),
  );

  revalidatePath("/admin/orders");
  return { ok: true, created, skipped };
}
