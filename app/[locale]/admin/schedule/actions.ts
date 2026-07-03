"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { lettersToBlocks, SHIFT_PRESETS, type ShiftKey } from "@/lib/master-schedule-core";
import { formatDateDE } from "@/lib/utils";

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
const lettersSchema = z.string().regex(/^(?!.*(.).*\1)[FSN]{0,3}$/); // subset of F,S,N, no repeats
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
  const blocks = lettersToBlocks(letters);

  await prisma.$transaction([
    prisma.workerAvailability.deleteMany({ where: { workerId, date: day } }),
    ...(blocks.length
      ? [
          prisma.workerAvailability.createMany({
            data: blocks.map((b) => ({
              workerId,
              date: day,
              status: "unavailable" as const,
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
          where: { date: day, status: "unavailable" },
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
    const unavailable = worker.availability.some(
      (b) =>
        b.startTime === null ||
        b.endTime === null ||
        overlaps(b.startTime, b.endTime, preset.start, preset.end),
    );
    if (unavailable) return { ok: false, error: "unavailable" };
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

      await tx.assignment.create({
        data: { orderId, workerId, status: "pending" },
      });
      await tx.notification.create({
        data: {
          userId: worker.userId,
          type: "worker_assigned",
          channel: "in_app",
          content: `${formatDateDE(day)} ${preset.start}–${preset.end} · ${client.facilityName}`,
        },
      });
    });
  } catch {
    // Unique (orderId, workerId) — already on this shift.
    return { ok: false, error: "saveError" };
  }

  await audit({
    userId: admin.id,
    action: "assignment.create",
    entity: "Worker",
    entityId: workerId,
    metadata: { date, shift, clientId, via: "master-schedule", forced: !!force },
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath("/worker");
  return { ok: true };
}

// Remove a grid assignment. A signed Leistungsnachweis makes the deployment a
// legal/financial record — those can never be removed here. If the order ends
// up with no workers it falls back to "pending" so it re-enters the pipeline
// (never deleted: the client may still see/expect the request).
export async function unassignFromGrid(assignmentId: string): Promise<ActionState> {
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
      id: true,
      workerId: true,
      serviceConfirmation: { select: { id: true } },
      worker: { select: { userId: true } },
      order: {
        select: {
          id: true,
          quantity: true,
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
      await tx.order.update({
        where: { id: assignment.order.id },
        data: { status: "pending" },
      });
    }
    await tx.notification.create({
      data: {
        userId: assignment.worker.userId,
        type: "order_status_changed",
        channel: "in_app",
        content: `${formatDateDE(assignment.order.shiftDate)} ${assignment.order.startTime}–${assignment.order.endTime} · ${assignment.order.client.facilityName}`,
      },
    });
  });

  await audit({
    userId: admin.id,
    action: "assignment.delete",
    entity: "Assignment",
    entityId: assignmentId,
    metadata: { workerId: assignment.workerId, via: "master-schedule" },
  });

  revalidatePath("/admin/schedule");
  revalidatePath("/admin/orders");
  revalidatePath("/worker");
  return { ok: true };
}
