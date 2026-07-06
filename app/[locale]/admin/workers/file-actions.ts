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
// Result of requesting a direct-to-storage upload: a one-time signed URL the
// browser uploads the file to, bypassing the Server Action / serverless request
// body limits (Next.js default 1 MB; Vercel 4.5 MB) that were failing on larger
// PDFs. The file never passes through our function — only this small ticket does.
type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (matches the bucket limit)

// Confirm an object actually exists at `path` before we record it, so a client
// that requests a ticket but never uploads can't create a dangling row.
async function objectExists(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  path: string,
): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const dir = path.slice(0, idx);
  const name = path.slice(idx + 1);
  const { data } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .list(dir, { search: name, limit: 100 });
  return Boolean(data?.some((o) => o.name === name));
}

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

// Step 1 — issue a signed upload URL for a new profile photo. Validates
// authorization + type + size on the tiny metadata only; the file is uploaded
// straight to Storage by the browser (see the component).
export async function createWorkerPhotoUpload(
  workerId: string,
  meta: { fileName: string; fileType: string; fileSize: number },
): Promise<UploadTicket> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!meta.fileSize || meta.fileSize <= 0) return { ok: false, error: "fileRequired" };
  if (!IMAGE_TYPES.includes(meta.fileType)) return { ok: false, error: "fileType" };
  if (meta.fileSize > MAX_BYTES) return { ok: false, error: "fileTooLarge" };

  const supabase = createSupabaseAdminClient();
  const path = `photos/${workerId}/${Date.now()}-${safeName(meta.fileName)}`;
  const { data, error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "saveError" };
  return { ok: true, path: data.path, token: data.token };
}

// Step 2 — once the browser has uploaded the file, record it as the worker's
// photo and drop the previous one. The path is pinned to this worker's folder.
export async function finalizeWorkerPhoto(
  workerId: string,
  path: string,
): Promise<ActionState> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!path.startsWith(`photos/${workerId}/`)) return { ok: false, error: "saveError" };

  const supabase = createSupabaseAdminClient();
  if (!(await objectExists(supabase, path))) return { ok: false, error: "saveError" };

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

// Step 1 — issue a signed upload URL for a certificate / ID / vaccination doc.
export async function createWorkerDocumentUpload(
  workerId: string,
  meta: { category: string; fileName: string; fileType: string; fileSize: number },
): Promise<UploadTicket> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!(documentCategories as readonly string[]).includes(meta.category)) {
    return { ok: false, error: "saveError" };
  }
  if (!meta.fileSize || meta.fileSize <= 0) return { ok: false, error: "fileRequired" };
  if (!DOC_TYPES.includes(meta.fileType)) return { ok: false, error: "fileType" };
  if (meta.fileSize > MAX_BYTES) return { ok: false, error: "fileTooLarge" };

  const supabase = createSupabaseAdminClient();
  const path = `documents/${workerId}/${Date.now()}-${safeName(meta.fileName)}`;
  const { data, error } = await supabase.storage
    .from(WORKER_FILES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "saveError" };
  return { ok: true, path: data.path, token: data.token };
}

// Step 2 — record the uploaded document once the browser finished the upload.
export async function finalizeWorkerDocument(
  workerId: string,
  meta: { category: string; fileName: string; path: string },
): Promise<ActionState> {
  const ctx = await authorizeWorker(workerId);
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!(documentCategories as readonly string[]).includes(meta.category)) {
    return { ok: false, error: "saveError" };
  }
  if (!meta.path.startsWith(`documents/${workerId}/`)) {
    return { ok: false, error: "saveError" };
  }

  const supabase = createSupabaseAdminClient();
  if (!(await objectExists(supabase, meta.path))) return { ok: false, error: "saveError" };

  await prisma.workerDocument.create({
    data: {
      workerId,
      category: meta.category as DocumentCategory,
      fileName: meta.fileName.slice(0, 200),
      filePath: meta.path,
    },
  });
  await audit({
    userId: ctx.user.id,
    action: "worker.document.upload",
    entity: "Worker",
    entityId: workerId,
    metadata: { category: meta.category },
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
