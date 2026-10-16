"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { netShiftHours } from "@/lib/pricing";
import { validateAndNormalizeProposedHours } from "@/lib/confirmation-evidence-service";
import {
  signTicket,
  verifyTicket,
  isTicketExpired,
  markTicketLocallyConsumed,
  isTicketLocallyConsumed,
  safeName,
  normalizeMimeType,
  detectMimeTypeFromBuffer,
} from "@/lib/confirmation-tickets";

export type UploadTicket =
  | { ok: true; path: string; token: string; ticket: string }
  | { ok: false; error: string };

export type FinalizeConfirmationParams = {
  assignmentIds: string[];
  path: string;
  ticket?: string;
  signerName?: string;
  clientNotes?: string;
  requestGroupId?: string;
  proposedHours?: number | string;
  _internalMeta?: unknown;
};

/**
 * Step 1: Generate a signed upload URL and unforgeable ticket for Supabase Storage.
 * Ticket is strictly bound to user, group, path, file properties, and expiration.
 */
export async function createConfirmationUploadTicket({
  requestGroupId,
  fileName,
  fileSize,
  fileType,
  assignmentIds,
}: {
  requestGroupId?: string;
  fileName: string;
  fileType?: string;
  fileSize: number;
  assignmentIds?: string[];
}): Promise<UploadTicket> {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }
  if (!fileSize || fileSize <= 0) {
    return { ok: false, error: "Bitte eine Datei auswählen." };
  }
  if (fileSize > 25 * 1024 * 1024) {
    return { ok: false, error: "Datei ist zu groß (max. 25 MB)." };
  }

  const mimeType = normalizeMimeType(fileName, fileType);
  const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(mimeType)) {
    return { ok: false, error: `Nicht unterstützter Dateityp '${mimeType}'. Erlaubt sind PDF, PNG, JPEG und WebP.` };
  }

  if (
    !assignmentIds ||
    !Array.isArray(assignmentIds) ||
    assignmentIds.length === 0 ||
    assignmentIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    return { ok: false, error: "Keine Schichten für das Upload-Ticket angegeben." };
  }

  const rawUniqueIds = Array.from(new Set(assignmentIds.map((id) => id.trim())));
  if (rawUniqueIds.length === 0) {
    return { ok: false, error: "Keine Schichten für das Upload-Ticket angegeben." };
  }

  const boundAssignmentIds = [...rawUniqueIds].sort();
  const assignments = await prisma.assignment.findMany({
    where: { id: { in: boundAssignmentIds } },
    include: {
      order: {
        select: {
          clientId: true,
          requestGroupId: true,
        },
      },
    },
  });

  if (assignments.length !== boundAssignmentIds.length) {
    return { ok: false, error: "Eine oder mehrere ausgewählte Schichten wurden nicht gefunden." };
  }

  const firstClientId = assignments[0].order.clientId;
  if (assignments.some((a) => a.order.clientId !== firstClientId)) {
    return { ok: false, error: "Schichten gehören zu unterschiedlichen Kunden." };
  }

  const firstGroup = assignments[0].order.requestGroupId;
  if (assignments.some((a) => a.order.requestGroupId !== firstGroup)) {
    return { ok: false, error: "Schichten gehören zu unterschiedlichen Auftragsgruppen." };
  }

  if (requestGroupId && firstGroup && safeName(firstGroup) !== safeName(requestGroupId)) {
    return { ok: false, error: "Schichten gehören nicht zur angegebenen Auftragsgruppe." };
  }

  const boundGroupId = safeName(firstGroup || requestGroupId || "") || "general";

  const randomSlug = crypto.randomBytes(8).toString("hex");
  const cleanFilename = safeName(fileName);
  const path = `signed-confirmations/${boundGroupId}/${Date.now()}-${randomSlug}-${cleanFilename}`;
  const { createLocalStorageClient } = await import("@/lib/local-storage");
  const supabase = createLocalStorageClient();

  const { data, error } = await supabase.storage
    .from("confirmations")
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    console.error("Failed to create signed upload url:", error);
    return { ok: false, error: "Fehler beim Vorbereiten des Uploads." };
  }

  const now = Date.now();
  const ticketId = crypto.randomBytes(16).toString("hex");
  let ticket: string;
  try {
    ticket = signTicket({
      userId: user.id,
      requestGroupId: boundGroupId,
      assignmentIds: boundAssignmentIds,
      path: data.path,
      fileName: cleanFilename,
      fileSize,
      mimeType,
      issuedAt: now,
      expiresAt: now + 15 * 60 * 1000, // 15 minutes
      ticketId,
    });
  } catch (err) {
    console.error("Failed to sign confirmation ticket:", err);
    return { ok: false, error: "Sicherheitskonfiguration für Upload-Tickets fehlt oder ist fehlerhaft." };
  }

  return { ok: true, path: data.path, token: data.token, ticket };
}

/**
 * Shared internal persistence logic.
 * Not exposed directly as a server action to prevent client parameter tampering.
 */
async function executeConfirmationPersistence({
  user,
  assignments,
  path,
  fileHash,
  fileSizeBytes,
  mimeType,
  cleanSignerName,
  cleanNotes,
  cleanGroupId,
  proposedHours,
  metadataExtra = {},
}: {
  user: { id: string; role: string };
  assignments: Array<{
    id: string;
    order: {
      id: string;
      startTime: string;
      endTime: string;
      breakMinutes: number;
      clientId: string;
      requestGroupId: string | null;
      client: { userId: string; facilityName: string };
    };
    worker: { id: string; userId: string; fullName: string } | null;
    serviceConfirmation: {
      id: string;
      method: string;
      hoursWorked: unknown;
      signatureData: string | null;
      signerName: string | null;
      confirmedAt: Date;
    } | null;
  }>;
  path: string;
  fileHash: string;
  fileSizeBytes: number;
  mimeType: string;
  cleanSignerName: string;
  cleanNotes: string;
  cleanGroupId: string;
  proposedHours?: number;
  metadataExtra?: Record<string, unknown>;
}) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 0. Durable atomic ticket consumption across multi-instance environments
    if (metadataExtra.ticketId && typeof metadataExtra.ticketId === "string") {
      await tx.consumedConfirmationTicket.create({
        data: {
          ticketId: metadataExtra.ticketId,
          storagePath: path,
          consumedBy: user.id,
          consumedAt: now,
        },
      });
    }

    for (const a of assignments) {
      const scheduledHours = netShiftHours(
        a.order.startTime,
        a.order.endTime,
        a.order.breakMinutes,
      );

      const hasExisting = Boolean(a.serviceConfirmation);
      const sourceType = hasExisting ? "manual_correction" : "manual_upload";

      // 1. Add immutable evidence document entry with real hash, size, and mime
      const doc = await tx.confirmationDocument.create({
        data: {
          assignmentId: a.id,
          sourceType,
          storagePath: path,
          fileName: path.split("/").pop() || null,
          fileHash,
          mimeType,
          fileSizeBytes,
          signerName: cleanSignerName,
          signerIp: ip,
          uploadedById: user.id,
          uploaderRole: "admin",
          metadata: { clientNotes: cleanNotes, requestGroupId: cleanGroupId, ...metadataExtra },
          createdAt: now,
        },
      });

      // 2. Safe ServiceConfirmation handling
      if (a.serviceConfirmation) {
        if (
          proposedHours !== undefined &&
          Number(a.serviceConfirmation.hoursWorked) !== proposedHours
        ) {
          await tx.workHoursCorrectionRequest.create({
            data: {
              assignmentId: a.id,
              documentId: doc.id,
              status: "proposed",
              previousHoursWorked: a.serviceConfirmation.hoursWorked as number,
              proposedHoursWorked: proposedHours,
              reason: cleanNotes,
              requestedById: user.id,
              requestedAt: now,
            },
          });
        }
      } else {
        const initialHours =
          proposedHours !== undefined ? proposedHours : scheduledHours;
        await tx.serviceConfirmation.create({
          data: {
            assignmentId: a.id,
            confirmedById: user.id,
            method: "upload",
            documentUrl: path,
            hoursWorked: initialHours,
            signerName: cleanSignerName,
            clientNotes: cleanNotes,
            ipAddress: ip,
            confirmedAt: now,
          },
        });
      }
    }

    const orderIds = Array.from(new Set(assignments.map((a) => a.order.id)));
    for (const orderId of orderIds) {
      const remainingUnconfirmed = await tx.assignment.count({
        where: {
          orderId,
          status: "confirmed",
          serviceConfirmation: { is: null },
        },
      });

      if (remainingUnconfirmed === 0) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "confirmed" },
        });
      }
    }

    const workerUserIds = Array.from(
      new Set(
        assignments
          .map((a) => a.worker?.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (workerUserIds.length > 0) {
      const firstOrder = assignments[0].order;
      await tx.notification.createMany({
        data: workerUserIds.map((wUserId) => ({
          userId: wUserId,
          type: "service_confirmed" as const,
          channel: "in_app" as const,
          content: `${firstOrder.client.facilityName} · Leistungsnachweis bestätigt (${assignments.length} Schicht(en))`,
          link: "/worker",
        })),
      });
    }
  });

  // Isolate post-commit audit and revalidation so commit never rolls back
  try {
    await audit({
      userId: user.id,
      action: "service_confirmation.bulk_upload",
      entity: "OrderGroup",
      entityId: cleanGroupId,
      ipAddress: ip,
      metadata: {
        assignmentCount: assignments.length,
        documentPath: path,
        signerName: cleanSignerName,
      },
    });

    revalidatePath("/", "layout");
  } catch (postCommitErr) {
    console.warn("Post-commit audit/revalidate failed:", postCommitErr);
  }
}

/**
 * Step 2: Finalize the confirmation records once the file is verified in Supabase storage.
 * Public Server Action strictly accessible by authenticated admin.
 * Requires signed upload ticket and verifies stored object bytes before DB write.
 */
export async function finalizeDirectSignedConfirmation(
  params: FinalizeConfirmationParams
): Promise<{ ok: boolean; count?: number; error?: string }> {
  // Reject browser attempt to supply internal metadata to bypass checks
  if ((params as { _internalMeta?: unknown })._internalMeta) {
    return { ok: false, error: "Ungültige Parameter." };
  }

  const {
    assignmentIds,
    path,
    ticket,
    signerName = "Manuell signiert",
    clientNotes = "Manuell signierter Leistungsnachweis",
    requestGroupId = "general",
    proposedHours: rawProposedHours,
  } = params;

  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }

  if (!assignmentIds || !assignmentIds.length) {
    return { ok: false, error: "Keine Schichten ausgewählt." };
  }

  // 0. Path format sanity check
  if (
    !path ||
    typeof path !== "string" ||
    path.includes("..") ||
    !/^signed-confirmations\/[a-zA-Z0-9_\-\.\/]+$/.test(path) ||
    path.split("/").length < 3
  ) {
    return { ok: false, error: "Ungültiger oder unzulässiger Dateipfad." };
  }

  if (!ticket || typeof ticket !== "string") {
    return { ok: false, error: "Kein Upload-Ticket angegeben." };
  }

  const ticketPayload = verifyTicket(ticket);
  if (!ticketPayload) {
    return { ok: false, error: "Ungültiges Upload-Ticket." };
  }

  if (isTicketExpired(ticketPayload)) {
    return { ok: false, error: "Upload-Ticket ist abgelaufen." };
  }

  if (ticketPayload.userId !== user.id) {
    return { ok: false, error: "Upload-Ticket gehört nicht zum aktuellen Benutzer." };
  }

  if (!path || path !== ticketPayload.path) {
    return { ok: false, error: "Dateipfad stimmt nicht mit dem Ticket überein." };
  }

  const cleanGroupId = safeName(requestGroupId) || "general";
  if (ticketPayload.requestGroupId !== cleanGroupId) {
    return { ok: false, error: "Upload-Ticket gehört zu einer anderen Gruppe." };
  }

  if (!path.startsWith(`signed-confirmations/${cleanGroupId}/`) || path.includes("..")) {
    return { ok: false, error: "Ungültiger oder unzulässiger Dateipfad." };
  }

  // Cross-instance replay prevention
  if (isTicketLocallyConsumed(ticketPayload.ticketId)) {
    return { ok: false, error: "Upload-Ticket wurde bereits verwendet." };
  }

  const existingByStoragePath = await prisma.confirmationDocument.findFirst({
    where: { storagePath: path },
  });
  if (existingByStoragePath) {
    return { ok: false, error: "Upload-Ticket wurde bereits verwendet." };
  }

  // Verify all assignments exist
  const assignments = await prisma.assignment.findMany({
    where: {
      id: { in: assignmentIds },
    },
    include: {
      order: {
        select: {
          id: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          clientId: true,
          requestGroupId: true,
          client: {
            select: {
              userId: true,
              facilityName: true,
            },
          },
        },
      },
      worker: {
        select: {
          id: true,
          userId: true,
          fullName: true,
        },
      },
      serviceConfirmation: {
        select: {
          id: true,
          method: true,
          hoursWorked: true,
          signatureData: true,
          signerName: true,
          confirmedAt: true,
        },
      },
    },
  });

  if (assignments.length !== assignmentIds.length) {
    return { ok: false, error: "Eine oder mehrere ausgewählte Schichten wurden nicht gefunden." };
  }

  // Mandatory exact assignment binding check: reject any ticket with missing/empty assignmentIds
  if (!Array.isArray(ticketPayload.assignmentIds) || ticketPayload.assignmentIds.length === 0) {
    return { ok: false, error: "Upload-Ticket ist an keine Schichten gebunden." };
  }

  const requestedSorted = [...assignmentIds].sort();
  if (
    requestedSorted.length !== ticketPayload.assignmentIds.length ||
    !requestedSorted.every((id, idx) => id === ticketPayload.assignmentIds[idx])
  ) {
    return { ok: false, error: "Ausgewählte Schichten stimmen nicht mit dem Upload-Ticket überein." };
  }

  // Scope check: facility consistency
  const firstClientId = assignments[0].order.clientId;
  if (assignments.some((a) => a.order.clientId !== firstClientId)) {
    return { ok: false, error: "Schichten gehören zu unterschiedlichen Kunden." };
  }

  // Scope check: group consistency across all assignments
  const firstGroupId = assignments[0].order.requestGroupId;
  if (assignments.some((a) => a.order.requestGroupId !== firstGroupId)) {
    return { ok: false, error: "Schichten gehören zu unterschiedlichen Auftragsgruppen." };
  }

  // Scope check: requestGroupId binding
  if (cleanGroupId !== "general" && firstGroupId && safeName(firstGroupId) !== cleanGroupId) {
    return { ok: false, error: "Schichten gehören nicht zur angegebenen Auftragsgruppe." };
  }

  // Mandatory object download and byte verification from Supabase storage
  const { createLocalStorageClient } = await import("@/lib/local-storage");
  const supabase = createLocalStorageClient();
  const storageFrom = supabase.storage.from("confirmations");

  if (typeof (storageFrom as unknown as { download?: (p: string) => Promise<{ data: unknown; error: unknown }> }).download !== "function") {
    return { ok: false, error: "Objektverifizierung im Speicher ist nicht verfügbar." };
  }

  const { data: blob, error: dlErr } = await (storageFrom as unknown as { download: (p: string) => Promise<{ data: Blob | null; error: unknown }> }).download(path);
  if (dlErr || !blob) {
    return { ok: false, error: "Die Datei wurde im Speicher nicht gefunden." };
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length !== ticketPayload.fileSize || buf.length > 25 * 1024 * 1024 || buf.length === 0) {
    return { ok: false, error: "Dateigröße im Speicher stimmt nicht mit dem Ticket überein." };
  }

  const detectedMime = detectMimeTypeFromBuffer(buf);
  if (!detectedMime) {
    return { ok: false, error: "Ungültiger oder nicht unterstützter Dateiinhalt. Erlaubt sind echte PDF-, PNG-, JPEG- oder WebP-Dateien." };
  }
  if (detectedMime !== ticketPayload.mimeType) {
    return { ok: false, error: "Dateityp im Speicher stimmt nicht mit dem Ticket überein." };
  }

  const fileHash = crypto.createHash("sha256").update(buf).digest("hex");
  const fileSizeBytes = buf.length;
  const mimeType = detectedMime;

  // Duplicate document check
  const existingDoc = await prisma.confirmationDocument.findFirst({
    where: {
      assignmentId: { in: assignmentIds },
      fileHash,
    },
  });
  if (existingDoc) {
    return { ok: false, error: "Dieses Dokument wurde für eine dieser Schichten bereits hochgeladen." };
  }

  let proposedHours: number | undefined;
  if (rawProposedHours !== undefined && rawProposedHours !== null && String(rawProposedHours).trim() !== "") {
    try {
      proposedHours = validateAndNormalizeProposedHours(rawProposedHours);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ungültiger Stundenwert.";
      return { ok: false, error: msg };
    }
  }

  try {
    await executeConfirmationPersistence({
      user,
      assignments,
      path,
      fileHash,
      fileSizeBytes,
      mimeType,
      cleanSignerName: signerName.trim() || "Manuell signiert",
      cleanNotes: clientNotes.trim() || "Manuell signierter Leistungsnachweis",
      cleanGroupId,
      proposedHours,
      metadataExtra: { ticketId: ticketPayload.ticketId },
    });

    markTicketLocallyConsumed(ticketPayload.ticketId, ticketPayload.expiresAt);
    return { ok: true, count: assignments.length };
  } catch (error: unknown) {
    console.error("Critical error in finalizeDirectSignedConfirmation:", error);
    const errorCode = (error as { code?: string })?.code;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const meta = (error as { meta?: { target?: string[] | string } })?.meta;

    const isTicketConsumed =
      (errorCode === "P2002" && (
        Array.isArray(meta?.target)
          ? meta.target.includes("ticketId") || meta.target.includes("ticket_id")
          : typeof meta?.target === "string"
            ? meta.target.includes("ticket_id") || meta.target.includes("ticketId") || meta.target.includes("consumed_confirmation_tickets")
            : false
      )) ||
      errorMsg.includes("consumed_confirmation_tickets_ticket_id_key") ||
      errorMsg.includes("(`ticket_id`)");

    if (isTicketConsumed) {
      return { ok: false, error: "Upload-Ticket wurde bereits verwendet." };
    }

    const isDocUnique =
      (errorCode === "P2002" && (
        Array.isArray(meta?.target)
          ? meta.target.includes("fileHash") || meta.target.includes("file_hash")
          : typeof meta?.target === "string"
            ? meta.target.includes("file_hash") || meta.target.includes("fileHash") || meta.target.includes("confirmation_documents")
            : false
      )) ||
      errorMsg.includes("confirmation_documents_assignment_id_file_hash_key") ||
      errorMsg.includes("(`assignment_id`,`file_hash`)");

    if (isDocUnique) {
      return { ok: false, error: "Dieses Dokument wurde für eine dieser Schichten bereits hochgeladen." };
    }

    const message = error instanceof Error ? error.message : "Fehler beim Speichern der Bestätigungen.";
    return { ok: false, error: message };
  }
}

/**
 * Fallback server action for direct FormData upload.
 * Performs real hashing, size and MIME extraction, and storage cleanup on DB failure.
 */
export async function uploadDirectSignedConfirmation(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    return { ok: false, error: "forbidden" };
  }

  let uploadedPath: string | null = null;
  const { createLocalStorageClient } = await import("@/lib/local-storage");
  const supabase = createLocalStorageClient();

  try {
    const assignmentIdsStr = formData.get("assignmentIds") as string;
    const file = formData.get("document") as File | null;
    const signerName = (formData.get("signerName") as string)?.trim() || "Manuell signiert";
    const clientNotes = (formData.get("clientNotes") as string)?.trim() || "Manuell signierter Leistungsnachweis";
    const requestGroupId = (formData.get("requestGroupId") as string)?.trim() || "general";
    const proposedHoursRaw = formData.get("proposedHours");

    if (!assignmentIdsStr || !file || typeof file !== "object" || !("size" in file) || file.size === 0) {
      return { ok: false, error: "Bitte wählen Sie eine Datei aus." };
    }

    let assignmentIds: string[];
    try {
      assignmentIds = JSON.parse(assignmentIdsStr);
    } catch {
      return { ok: false, error: "Ungültige Schichten-Auswahl." };
    }

    if (!assignmentIds.length) {
      return { ok: false, error: "Keine Schichten ausgewählt." };
    }

    let proposedHours: number | undefined;
    if (proposedHoursRaw !== null && proposedHoursRaw !== undefined && String(proposedHoursRaw).trim() !== "") {
      try {
        proposedHours = validateAndNormalizeProposedHours(proposedHoursRaw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ungültiger Stundenwert.";
        return { ok: false, error: msg };
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 25 * 1024 * 1024 || buffer.length === 0) {
      return { ok: false, error: "Datei ist ungültig oder zu groß (max. 25 MB)." };
    }

    const detectedMime = detectMimeTypeFromBuffer(buffer);
    if (!detectedMime) {
      return { ok: false, error: "Ungültiger oder nicht unterstützter Dateiinhalt. Erlaubt sind echte PDF-, PNG-, JPEG- oder WebP-Dateien." };
    }
    const contentType = detectedMime;

    // Pre-validate that all requested assignments exist
    const assignments = await prisma.assignment.findMany({
      where: { id: { in: assignmentIds } },
      include: {
        order: {
          select: {
            id: true,
            shiftDate: true,
            startTime: true,
            endTime: true,
            breakMinutes: true,
            clientId: true,
            requestGroupId: true,
            client: {
              select: {
                userId: true,
                facilityName: true,
              },
            },
          },
        },
        worker: {
          select: {
            id: true,
            userId: true,
            fullName: true,
          },
        },
        serviceConfirmation: {
          select: {
            id: true,
            method: true,
            hoursWorked: true,
            signatureData: true,
            signerName: true,
            confirmedAt: true,
          },
        },
      },
    });

    if (assignments.length !== assignmentIds.length) {
      return { ok: false, error: "Eine oder mehrere ausgewählte Schichten wurden nicht gefunden." };
    }

    const firstClientId = assignments[0].order.clientId;
    if (assignments.some((a) => a.order.clientId !== firstClientId)) {
      return { ok: false, error: "Schichten gehören zu unterschiedlichen Kunden." };
    }

    const cleanGroupId = safeName(requestGroupId) || "general";
    if (cleanGroupId !== "general") {
      const scopeMismatch = assignments.some(
        (a) => a.order.requestGroupId && safeName(a.order.requestGroupId) !== cleanGroupId
      );
      if (scopeMismatch) {
        return { ok: false, error: "Schichten gehören nicht zur angegebenen Auftragsgruppe." };
      }
    }

    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const fileSizeBytes = buffer.length;

    // Check duplicate before uploading
    const existingSame = await prisma.confirmationDocument.findFirst({
      where: {
        assignmentId: { in: assignmentIds },
        fileHash,
      },
    });
    if (existingSame) {
      return { ok: false, error: "Dieses Dokument wurde für eine dieser Schichten bereits hochgeladen." };
    }

    const randomSlug = crypto.randomBytes(8).toString("hex");
    const cleanFilename = safeName(file.name);
    const path = `signed-confirmations/${cleanGroupId}/${Date.now()}-${randomSlug}-${cleanFilename}`;

    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(path, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase confirmation upload error:", uploadError);
      return { ok: false, error: `Upload-Fehler: ${uploadError.message}` };
    }
    uploadedPath = path;

    await executeConfirmationPersistence({
      user,
      assignments,
      path,
      fileHash,
      fileSizeBytes,
      mimeType: contentType,
      cleanSignerName: signerName.trim() || "Manuell signiert",
      cleanNotes: clientNotes.trim() || "Manuell signierter Leistungsnachweis",
      cleanGroupId,
      proposedHours,
      metadataExtra: { uploadMethod: "fallback_form_data" },
    });

    return { ok: true, count: assignments.length };
  } catch (error: unknown) {
    if (uploadedPath) {
      try {
        const { error: remErr } = await supabase.storage.from("confirmations").remove([uploadedPath]);
        if (remErr) console.error("Failed to clean up storage file after exception:", remErr);
      } catch (cleanupErr) {
        console.error("Failed to clean up storage on exception:", cleanupErr);
      }
    }
    console.error("Critical error in uploadDirectSignedConfirmation:", error);
    const errorCode = (error as { code?: string })?.code;
    const errorMsg = error instanceof Error ? error.message : String(error);
    const meta = (error as { meta?: { target?: string[] | string } })?.meta;
    const isDocUnique =
      (errorCode === "P2002" && (
        Array.isArray(meta?.target)
          ? meta.target.includes("fileHash") || meta.target.includes("file_hash")
          : typeof meta?.target === "string"
            ? meta.target.includes("file_hash") || meta.target.includes("fileHash") || meta.target.includes("confirmation_documents")
            : false
      )) ||
      errorMsg.includes("confirmation_documents_assignment_id_file_hash_key") ||
      errorMsg.includes("(`assignment_id`,`file_hash`)");

    if (isDocUnique) {
      return { ok: false, error: "Dieses Dokument wurde für eine dieser Schichten bereits hochgeladen." };
    }
    const message = error instanceof Error ? error.message : "Unerwarteter Fehler beim Hochladen.";
    return { ok: false, error: message };
  }
}
