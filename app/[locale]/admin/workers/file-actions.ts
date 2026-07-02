"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { documentCategories } from "@/lib/validations";
import { WORKER_FILES_BUCKET } from "@/lib/worker-files";
import type { DocumentCategory } from "@prisma/client";

type ActionState = { ok: boolean; error?: string };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (matches the bucket limit)

// Admin/super_admin may manage any worker's files; a worker may manage only their
// own. Returns the worker (id + userId) when allowed, else null.
async function authorizeWorker(workerId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const worker = await prisma.worker.findUnique({
    where: { id: workerId },
    select: { id: true, userId: true, photoPath: true },
  });
  if (!worker) return null;
  const allowed = roleSatisfies(user.role, ["admin"]) || worker.userId === user.id;
  return allowed ? { user, worker } : null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

// Upload (or replace) the worker's profile photo.
export async function uploadWorkerPhoto(
  workerId: string,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "fileRequired" };
  }
  if (!IMAGE_TYPES.includes(file.type)) return { ok: false, error: "fileType" };
  if (file.size > MAX_BYTES) return { ok: false, error: "fileTooLarge" };

  const supabase = createSupabaseAdminClient();
  const path = `photos/${workerId}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: "saveError" };

  // Best-effort removal of the previous photo so we don't orphan files.
  if (ctx.worker.photoPath) {
    await supabase.storage
      .from(WORKER_FILES_BUCKET)
      .remove([ctx.worker.photoPath])
      .catch(() => {});
  }

  await prisma.worker.update({ where: { id: workerId }, data: { photoPath: path } });
  await audit({
    userId: ctx.user.id,
    action: "worker.photo.upload",
    entity: "Worker",
    entityId: workerId,
  });

  revalidatePath(`/admin/workers/${workerId}/edit`);
  revalidatePath("/worker/documents");
  return { ok: true };
}

export async function deleteWorkerPhoto(workerId: string): Promise<ActionState> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };
  if (ctx.worker.photoPath) {
    const supabase = createSupabaseAdminClient();
    await supabase.storage
      .from(WORKER_FILES_BUCKET)
      .remove([ctx.worker.photoPath])
      .catch(() => {});
  }
  await prisma.worker.update({ where: { id: workerId }, data: { photoPath: null } });
  await audit({
    userId: ctx.user.id,
    action: "worker.photo.delete",
    entity: "Worker",
    entityId: workerId,
  });
  revalidatePath(`/admin/workers/${workerId}/edit`);
  revalidatePath("/worker/documents");
  return { ok: true };
}

// Upload a certificate / ID / vaccination document for a worker.
export async function uploadWorkerDocument(
  workerId: string,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };

  const category = String(formData.get("category") ?? "");
  if (!(documentCategories as readonly string[]).includes(category)) {
    return { ok: false, error: "saveError" };
  }
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "fileRequired" };
  }
  if (!DOC_TYPES.includes(file.type)) return { ok: false, error: "fileType" };
  if (file.size > MAX_BYTES) return { ok: false, error: "fileTooLarge" };

  const supabase = createSupabaseAdminClient();
  const path = `documents/${workerId}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: "saveError" };

  await prisma.workerDocument.create({
    data: {
      workerId,
      category: category as DocumentCategory,
      fileName: file.name.slice(0, 200),
      filePath: path,
    },
  });
  await audit({
    userId: ctx.user.id,
    action: "worker.document.upload",
    entity: "Worker",
    entityId: workerId,
    metadata: { category },
  });

  revalidatePath(`/admin/workers/${workerId}/edit`);
  revalidatePath("/worker/documents");
  return { ok: true };
}

export async function deleteWorkerDocument(docId: string): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "forbidden" };
  const doc = await prisma.workerDocument.findUnique({
    where: { id: docId },
    select: { filePath: true, workerId: true, worker: { select: { userId: true } } },
  });
  if (!doc) return { ok: false, error: "saveError" };
  const allowed =
    roleSatisfies(user.role, ["admin"]) || doc.worker.userId === user.id;
  if (!allowed) return { ok: false, error: "forbidden" };

  const supabase = createSupabaseAdminClient();
  await supabase.storage.from(WORKER_FILES_BUCKET).remove([doc.filePath]).catch(() => {});
  await prisma.workerDocument.delete({ where: { id: docId } });
  await audit({
    userId: user.id,
    action: "worker.document.delete",
    entity: "WorkerDocument",
    entityId: docId,
  });
  revalidatePath(`/admin/workers/${doc.workerId}/edit`);
  revalidatePath("/worker/documents");
  return { ok: true };
}

// Only an admin marks a document verified after reviewing it.
export async function setWorkerDocumentVerified(
  docId: string,
  verified: boolean,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }
  const doc = await prisma.workerDocument.update({
    where: { id: docId },
    data: { verified },
    select: { workerId: true },
  });
  await audit({
    userId: user.id,
    action: "worker.document.verify",
    entity: "WorkerDocument",
    entityId: docId,
    metadata: { verified },
  });
  revalidatePath(`/admin/workers/${doc.workerId}/edit`);
  return { ok: true };
}
