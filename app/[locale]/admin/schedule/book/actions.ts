"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { z } from "zod";
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) throw new Error("forbidden");
  return user;
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function saveDailyNote(
  dateStr: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!dateSchema.safeParse(dateStr).success) {
    return { ok: false, error: "invalid_date" };
  }

  const key = `daily_note_${dateStr}`;
  const trimmed = note.trim();

  try {
    if (trimmed.length === 0) {
      await prisma.systemSetting.deleteMany({
        where: { key },
      });
    } else {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: trimmed },
        create: { key, value: trimmed },
      });
    }

    await audit({
      userId: admin.id,
      action: "dailyNote.save",
      entity: "SystemSetting",
      entityId: key,
      metadata: { date: dateStr, noteLength: trimmed.length },
    });

    revalidatePath("/admin/schedule/book");
    return { ok: true };
  } catch (err) {
    console.error("Failed to save daily note:", err);
    return { ok: false, error: "save_failed" };
  }
}

export async function acceptAssignmentOnBehalfOfWorker(
  assignmentId: string
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { order: true, worker: true },
  });
  if (!assignment) return { ok: false, error: "not_found" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: "confirmed",
          confirmedAt: new Date(),
          cancelRequested: false,
          cancelNote: null,
        },
      });

      if (["pending", "review", "availability_check", "assigned"].includes(assignment.order.status)) {
        await tx.order.update({
          where: { id: assignment.orderId },
          data: { status: "accepted" },
        });
      }
    });

    await audit({
      userId: admin.id,
      action: "assignment.accept_on_behalf",
      entity: "Assignment",
      entityId: assignmentId,
      metadata: {
        workerId: assignment.workerId,
        workerName: assignment.worker.fullName,
        orderId: assignment.orderId,
      },
    });

    revalidatePath("/admin/schedule");
    revalidatePath("/admin/schedule/book");
    revalidatePath(`/admin/workers/${assignment.workerId}/schedule`);
    revalidatePath("/worker");

    return { ok: true };
  } catch (err) {
    console.error("Failed to accept assignment on behalf of worker:", err);
    return { ok: false, error: "save_failed" };
  }
}

export async function replaceWorkerOnAssignment(
  assignmentId: string,
  newWorkerId: string,
  force = false
): Promise<{ ok: boolean; error?: string }> {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const existing = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { order: true },
  });
  if (!existing) return { ok: false, error: "not_found" };

  const { unassignFromGrid, assignWorkerToOrder } = await import(
    "@/app/[locale]/admin/schedule/actions"
  );

  const unassignRes = await unassignFromGrid(assignmentId);
  if (!unassignRes.ok) return unassignRes;

  const assignRes = await assignWorkerToOrder(existing.orderId, newWorkerId, force);
  return assignRes;
}
