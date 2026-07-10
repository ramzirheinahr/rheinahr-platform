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
import { offerAssignmentsBulk } from "@/lib/assignments";
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
      breakMinutes: s.pause,
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
      breakMinutes: true,
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
      breakMinutes: s.pause,
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
          data: { quantity: u.quantity, breakMinutes: u.breakMinutes, notes: u.notes },
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
                breakMinutes: s.breakMinutes,
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

// Admin deleting a whole request (all shifts sharing the requestGroupId) — a
// HARD delete on the owner's instruction: the order rows are removed from the
// database (assignments cascade), nothing stays behind marked "cancelled".
// Admins are not bound to the client's cutoff, but a request whose shifts
// already ran / were confirmed / carry a signed Leistungsnachweis cannot be
// deleted. Client and assigned workers are notified; the audit log keeps the
// deletion trace.
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
  // Extra guard before destroying rows: a signed Leistungsnachweis anywhere in
  // the group is a legal record — never delete it.
  const signed = await prisma.serviceConfirmation.count({
    where: { assignment: { order: { requestGroupId } } },
  });
  if (signed > 0) return { ok: false, error: "locked" };

  const client = await prisma.client.findUnique({
    where: { id: existing[0].clientId },
    select: { userId: true, facilityName: true },
  });

  // Workers holding an active invitation/acceptance lose the shift — tell them.
  const affected = await prisma.assignment.findMany({
    where: { order: { requestGroupId }, status: { not: "declined" } },
    select: { worker: { select: { userId: true } } },
  });
  const workerUserIds = [...new Set(affected.map((a) => a.worker.userId))];

  await prisma.$transaction([
    prisma.order.deleteMany({ where: { requestGroupId } }),
    ...(client?.userId
      ? [
          prisma.notification.create({
            data: {
              userId: client.userId,
              type: "order_status_changed",
              channel: "in_app",
              content: `${client.facilityName}: Anfrage gelöscht – ${existing.length} Schicht(en)`,
              link: "/client/orders",
            },
          }),
        ]
      : []),
    ...workerUserIds.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          type: "order_status_changed",
          channel: "in_app",
          content: `Einsatz gelöscht – ${client?.facilityName ?? "Anfrage entfernt"}`,
          link: workerShiftLink(),
        },
      }),
    ),
  ]);

  if (workerUserIds.length > 0) {
    await pushToUsers(workerUserIds, {
      title: "Einsatz gelöscht",
      body: client?.facilityName ?? "Anfrage entfernt",
      url: workerShiftLink(),
    });
  }

  await audit({
    userId: admin.id,
    action: "order.request.delete",
    entity: "Order",
    entityId: requestGroupId,
    metadata: { byAdmin: true, shifts: existing.length, hardDelete: true },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin/schedule");
  revalidatePath("/client/orders");
  revalidatePath("/worker");
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
  // Creates brand-new offers and RESURRECTS ones a worker previously declined
  // (a re-offer of the same shift must reach them again — the old skipDuplicates
  // path silently left the stale "declined" row untouched). Only the pairs that
  // became a fresh pending offer get notified.
  const { fresh } = await offerAssignmentsBulk(prisma, offers);
  const freshKeys = new Set(fresh.map((f) => `${f.orderId}:${f.workerId}`));
  const notify = offers.filter((o) => freshKeys.has(`${o.orderId}:${o.workerId}`));
  if (notify.length) {
    await prisma.notification.createMany({
      data: notify.map((o) => ({
        userId: o.userId,
        type: "worker_assigned" as const,
        channel: "in_app" as const,
        content: o.content,
        link: workerShiftLink(),
      })),
    });
  }
  if (advanceIds.length) {
    await prisma.order.updateMany({
      where: { id: { in: advanceIds } },
      data: { status: "assigned" },
    });
  }
  const created = notify.length;

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

  // One push per worker summarising how many shifts they were freshly offered.
  const perWorker = new Map<string, number>();
  for (const o of notify) perWorker.set(o.userId, (perWorker.get(o.userId) ?? 0) + 1);
  await Promise.all(
    [...perWorker].map(([userId, n]) =>
      pushToUsers([userId], {
        title: "Neue Einsätze",
        body: n === 1 ? notify.find((o) => o.userId === userId)!.content : `${n} neue Schicht(en)`,
        url: workerShiftLink(),
      }),
    ),
  );

  revalidatePath("/admin/orders");
  return { ok: true, created, skipped };
}

// ── Client-requested shift-window correction (filed while confirming) ──────
// The client signed the Leistungsnachweis but flagged that the shift actually
// ran at different times. Approving applies the new window to the order,
// recomputes the net hours, regenerates the signed PDF (Textform, admin acting
// on the request), and clears the pending fields. Rejecting just clears them.

export async function approveTimeChange(input: {
  assignmentId: string;
  signerName: string;
}): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const { z } = await import("zod");
  if (
    !z.string().uuid().safeParse(input.assignmentId).success ||
    !z.string().trim().min(2).max(120).safeParse(input.signerName).success
  ) {
    return { ok: false, error: "nameRequired" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: input.assignmentId },
    include: {
      serviceConfirmation: true,
      order: {
        select: {
          id: true,
          requestGroupId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
      worker: { select: { userId: true, fullName: true, qualification: true } },
    },
  });
  const sc = assignment?.serviceConfirmation;
  if (!assignment || !sc || !sc.requestedStart || !sc.requestedEnd) {
    return { ok: false, error: "saveError" };
  }
  const newStart = sc.requestedStart;
  const newEnd = sc.requestedEnd;

  const { netShiftHours } = await import("@/lib/pricing");
  const newHours = netShiftHours(newStart, newEnd, assignment.order.breakMinutes);

  const { headers } = await import("next/headers");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  // Regenerate the signed Leistungsnachweis with the corrected window + hours.
  const [{ renderLeistungsnachweisPdf }, { qualLabel, methodLabel }] = await Promise.all([
    import("@/lib/pdf/leistungsnachweis"),
    import("@/lib/invoicing"),
  ]);
  const pdf = await renderLeistungsnachweisPdf({
    facilityName: assignment.order.client.facilityName,
    workerName: assignment.worker.fullName,
    qualificationLabel: qualLabel[assignment.worker.qualification],
    shiftDate: assignment.order.shiftDate.toISOString().slice(0, 10),
    startTime: newStart,
    endTime: newEnd,
    hours: newHours,
    methodLabel: methodLabel.electronic,
    isElectronic: true,
    signerName: input.signerName.trim(),
    confirmedByEmail: admin.email,
    confirmedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    ipAddress: ip,
    orderId: assignment.order.id,
    assignmentId: assignment.id,
    draft: false,
  });
  const path = `${assignment.id}/signed/leistungsnachweis-${Date.now()}.pdf`;
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.storage
    .from("confirmations")
    .upload(path, new Uint8Array(pdf), { contentType: "application/pdf", upsert: false });
  if (error) return { ok: false, error: "saveError" };

  const oldWindow = `${assignment.order.startTime}–${assignment.order.endTime}`;
  await prisma.$transaction([
    prisma.order.update({
      where: { id: assignment.order.id },
      data: { startTime: newStart, endTime: newEnd },
    }),
    prisma.serviceConfirmation.update({
      where: { id: sc.id },
      data: {
        hoursWorked: newHours,
        documentUrl: path,
        confirmedById: admin.id,
        confirmedAt: new Date(),
        ipAddress: ip,
        requestedStart: null,
        requestedEnd: null,
      },
    }),
  ]);

  const dateLabel = formatDateDE(assignment.order.shiftDate);
  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  const summary = `Zeitkorrektur genehmigt (${dateLabel}): ${oldWindow} → ${newStart}–${newEnd} · ${newHours} Std.`;
  const recipients = [
    ...(assignment.order.client.userId
      ? [{ id: assignment.order.client.userId, role: "client" as const }]
      : []),
    { id: assignment.worker.userId, role: "worker" as const },
  ];
  await prisma.notification.createMany({
    data: recipients.map((r) => ({
      userId: r.id,
      type: "service_confirmed" as const,
      channel: "in_app" as const,
      content: summary,
      link: r.role === "worker" ? workerShiftLink() : orderLink("client", reqGroup),
    })),
  });
  await pushToUsers(
    recipients.map((r) => r.id),
    { title: "Zeitkorrektur genehmigt", body: summary, url: "/" },
  );

  await audit({
    userId: admin.id,
    action: "service.timeChangeApprove",
    entity: "Assignment",
    entityId: assignment.id,
    ipAddress: ip,
    metadata: { from: oldWindow, to: `${newStart}-${newEnd}`, hours: newHours },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${reqGroup}`);
  revalidatePath("/admin/schedule");
  revalidatePath("/client/orders");
  revalidatePath("/worker");
  return { ok: true };
}

export async function rejectTimeChange(assignmentId: string): Promise<ActionState> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const { z } = await import("zod");
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return { ok: false, error: "saveError" };
  }
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      serviceConfirmation: { select: { id: true, requestedStart: true, requestedEnd: true } },
      order: {
        select: {
          requestGroupId: true,
          id: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          client: { select: { userId: true, facilityName: true } },
        },
      },
    },
  });
  const sc = assignment?.serviceConfirmation;
  if (!assignment || !sc || !sc.requestedStart || !sc.requestedEnd) {
    return { ok: false, error: "saveError" };
  }

  await prisma.serviceConfirmation.update({
    where: { id: sc.id },
    data: { requestedStart: null, requestedEnd: null },
  });

  const reqGroup = assignment.order.requestGroupId ?? assignment.order.id;
  if (assignment.order.client.userId) {
    await prisma.notification.create({
      data: {
        userId: assignment.order.client.userId,
        type: "order_status_changed",
        channel: "in_app",
        content: `Zeitkorrektur abgelehnt (${formatDateDE(assignment.order.shiftDate)}): ${assignment.order.startTime}–${assignment.order.endTime} bleibt bestehen.`,
        link: orderLink("client", reqGroup),
      },
    });
  }

  await audit({
    userId: admin.id,
    action: "service.timeChangeReject",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: {
      requested: `${sc.requestedStart}-${sc.requestedEnd}`,
    },
  });

  revalidatePath(`/admin/orders/${reqGroup}`);
  revalidatePath("/client/orders");
  return { ok: true };
}
