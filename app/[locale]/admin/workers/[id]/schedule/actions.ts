"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addWorkerAdjustment(
  workerId: string,
  month: string,
  type: "k_ausgleich" | "sonstige" | "urlaub" | "krank",
  hours: number,
  notes: string
) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  await prisma.workerHoursAdjustment.create({
    data: {
      workerId,
      month,
      type,
      hours,
      notes,
    },
  });

  // Automatically sync note into Arbeitszeitkonto (azk.note) if notes is provided
  if (notes && notes.trim()) {
    const key = `azk.note.${workerId}.${month}`;
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    const trimmed = notes.trim();
    if (!existing || !existing.value) {
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: trimmed },
        update: { value: trimmed },
      });
    } else if (!existing.value.includes(trimmed)) {
      const updated = `${existing.value}; ${trimmed}`;
      await prisma.systemSetting.update({
        where: { key },
        data: { value: updated },
      });
    }
  }

  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath(`/admin/reports`);
  revalidatePath(`/worker`);
}

export async function saveWorkerMonthlyNoteAction(
  workerId: string,
  month: string,
  note: string
) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  const key = `azk.note.${workerId}.${month}`;
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: note },
    update: { value: note },
  });

  revalidatePath(`/admin/workers/${workerId}/schedule`);
  revalidatePath(`/admin/reports`);
  return { success: true };
}

export async function deleteWorkerAdjustment(id: string) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  const adj = await prisma.workerHoursAdjustment.findUnique({
    where: { id },
  });

  if (adj) {
    await prisma.workerHoursAdjustment.delete({
      where: { id },
    });
    revalidatePath(`/admin/workers/${adj.workerId}/schedule`);
    revalidatePath(`/worker`);
  }
}

export async function uploadWorkerConfirmationEvidenceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    return { ok: false, error: "Unauthorized" };
  }

  const workerId = formData.get("workerId") as string;
  const signerName = (formData.get("signerName") as string) || undefined;
  const notes = (formData.get("notes") as string) || undefined;
  const file = formData.get("file") as File | null;

  if (!file || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Bitte eine Datei auswählen." };
  }

  const assignmentIdsRaw = formData.getAll("assignmentIds");
  let assignmentIds: string[] = [];
  if (
    assignmentIdsRaw.length === 1 &&
    typeof assignmentIdsRaw[0] === "string" &&
    assignmentIdsRaw[0].startsWith("[")
  ) {
    try {
      assignmentIds = JSON.parse(assignmentIdsRaw[0]);
    } catch {
      assignmentIds = [assignmentIdsRaw[0]];
    }
  } else {
    assignmentIds = assignmentIdsRaw.map(String);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const { uploadWorkerMultiShiftEvidence } = await import(
      "@/lib/confirmation-evidence-service"
    );
    const res = await uploadWorkerMultiShiftEvidence({
      workerId,
      assignmentIds,
      file: {
        buffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      },
      signerName,
      notes,
      currentUser: user,
    });

    revalidatePath(`/admin/workers/${workerId}/schedule`);
    revalidatePath(`/admin/clients`);
    revalidatePath(`/admin/orders`);
    revalidatePath(`/worker`);

    return { ok: true, count: res.count };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Fehler beim Hochladen.";
    return { ok: false, error: msg };
  }
}

export async function getShiftEvidenceTimelineAction(assignmentId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const { getAssignmentEvidenceHistory, sanitizePublicEvidenceTimeline } =
      await import("@/lib/confirmation-evidence-service");
    const rawTimeline = await getAssignmentEvidenceHistory(assignmentId, user);
    const timeline = sanitizePublicEvidenceTimeline(rawTimeline);
    const canAdminDecide = user.role === "admin" || user.role === "super_admin";
    return { ok: true, timeline, canAdminDecide };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Fehler beim Laden der Nachweise.";
    return { ok: false, error: msg };
  }
}

export async function proposeHoursCorrectionAction(params: {
  assignmentId: string;
  documentId: string;
  expectedEffectiveVersion: string;
  expectedBaselineHours?: number | null;
  proposedHours?: number | string;
  proposedStartTime?: string | null;
  proposedEndTime?: string | null;
  proposedBreakMinutes?: number | string | null;
  reason?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }

  if (!params.expectedEffectiveVersion || !params.expectedEffectiveVersion.trim()) {
    return { ok: false, error: "missing_version" };
  }

  try {
    const { createOrUpdateHoursCorrectionRequest } = await import(
      "@/lib/confirmation-evidence-service"
    );
    const request = await createOrUpdateHoursCorrectionRequest({
      assignmentId: params.assignmentId,
      documentId: params.documentId,
      expectedEffectiveVersion: params.expectedEffectiveVersion,
      expectedBaselineHours: params.expectedBaselineHours,
      proposedHours: params.proposedHours,
      proposedStartTime: params.proposedStartTime,
      proposedEndTime: params.proposedEndTime,
      proposedBreakMinutes: params.proposedBreakMinutes,
      reason: params.reason,
      currentUser: user,
    });

    revalidatePath("/admin/workers");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/orders");
    return { ok: true, requestId: request.id };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Fehler beim Einreichen des Korrekturvorschlags.";
    return { ok: false, error: msg };
  }
}

export async function approveHoursCorrectionAction(params: {
  correctionRequestId: string;
  expectedEffectiveVersion: string;
  effectiveStartTime?: string | null;
  effectiveEndTime?: string | null;
  effectiveBreakMinutes?: number | string | null;
  decisionNote?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }

  if (!params.expectedEffectiveVersion || !params.expectedEffectiveVersion.trim()) {
    return { ok: false, error: "missing_version" };
  }

  try {
    const { approveHoursCorrectionRequest } = await import(
      "@/lib/confirmation-evidence-service"
    );
    const result = await approveHoursCorrectionRequest({
      correctionRequestId: params.correctionRequestId,
      expectedEffectiveVersion: params.expectedEffectiveVersion,
      effectiveStartTime: params.effectiveStartTime,
      effectiveEndTime: params.effectiveEndTime,
      effectiveBreakMinutes: params.effectiveBreakMinutes,
      decisionNote: params.decisionNote,
      currentUser: user,
    });

    revalidatePath("/admin/workers");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/orders");
    return { ok: true, result };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Fehler beim Genehmigen der Stundenkorrektur.";
    return { ok: false, error: msg };
  }
}

export async function rejectHoursCorrectionAction(params: {
  correctionRequestId: string;
  decisionNote?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return { ok: false, error: "forbidden" };
  }

  try {
    const { rejectHoursCorrectionRequest } = await import(
      "@/lib/confirmation-evidence-service"
    );
    const result = await rejectHoursCorrectionRequest({
      correctionRequestId: params.correctionRequestId,
      decisionNote: params.decisionNote,
      currentUser: user,
    });

    revalidatePath("/admin/workers");
    revalidatePath("/admin/clients");
    revalidatePath("/admin/orders");
    return { ok: true, result };
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Fehler beim Ablehnen der Stundenkorrektur.";
    return { ok: false, error: msg };
  }
}
