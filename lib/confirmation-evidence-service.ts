import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { netShiftHours } from "@/lib/pricing";
import { detectMimeTypeFromBuffer } from "@/lib/confirmation-tickets";
import type { ConfirmationDocumentSourceType, HoursCorrectionStatus } from "@prisma/client";

export const MAX_CONFIRMATION_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_CONFIRMATION_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export class ConfirmationEvidenceError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(`[${code}] ${message}`);
    this.name = "ConfirmationEvidenceError";
    this.code = code;
    this.status = status;
  }
}

export type EvidenceFilePayload = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type AddEvidenceParams = {
  assignmentId: string;
  file?: EvidenceFilePayload;
  storagePath?: string;
  fileHash?: string;
  sourceType?: ConfirmationDocumentSourceType;
  signerName?: string;
  signerIp?: string;
  signatureData?: string;
  proposedHours?: number;
  proposedStartTime?: string;
  proposedEndTime?: string;
  proposedBreakMinutes?: number;
  correctionReason?: string;
  clientNotes?: string;
  requestGroupId?: string;
  currentUser: {
    id: string;
    role: string;
    clientId?: string | null;
  };
};

export type EvidenceDocumentView = {
  id: string;
  assignmentId: string;
  sourceType: ConfirmationDocumentSourceType;
  storagePath: string | null;
  fileHash: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  signatureData: string | null;
  signerName: string | null;
  signerIp: string | null;
  uploadedById: string | null;
  uploaderRole: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
  isArchivedPdf: boolean;
  isDynamicallyGeneratedView: boolean;
  isPhysicalScan: boolean;
};

export type EvidenceTimeline = {
  assignmentId: string;
  orderId: string;
  workerId: string;
  workerName: string;
  clientId: string;
  facilityName: string;
  shiftDate: string;
  scheduledHours: number;
  currentApprovedHours: number | null;
  currentMethod: "electronic" | "upload" | null;
  legacyConfirmation: {
    exists: boolean;
    method: "electronic" | "upload" | null;
    hoursWorked: number | null;
    hasArchivedPdf: boolean;
    isDynamicallyGeneratedView: boolean;
    hasSignatureImage: boolean;
    signerName: string | null;
    confirmedAt: string | null;
  } | null;
  legacyBaseline: {
    exists: boolean;
    method: "electronic" | "upload" | null;
    hoursWorked: number | null;
    hasArchivedPdf: boolean;
    isDynamicallyGeneratedView: boolean;
    hasSignatureImage: boolean;
    signerName: string | null;
    confirmedAt: string | null;
  } | null;
  documents: EvidenceDocumentView[];
  pendingCorrection: {
    id: string;
    status: HoursCorrectionStatus;
    previousHoursWorked: number | null;
    proposedHoursWorked: number;
    proposedStartTime: string | null;
    proposedEndTime: string | null;
    proposedBreakMinutes: number | null;
    reason: string | null;
    requestedAt: string;
    requestedById: string | null;
  } | null;
};

/**
 * Computes deterministic SHA-256 hex digest for document byte verification.
 */
export function computeFileSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Sanitizes file names to prevent directory traversal or invalid characters.
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Verifies caller authorization against the assignment context.
 * Strict ownership boundary: prevents client A from touching client B's orders,
 * or worker A from touching worker B's shifts.
 */
export async function assertAssignmentAccess(
  assignmentId: string,
  user: { id: string; role: string; clientId?: string | null }
) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      order: {
        select: {
          id: true,
          clientId: true,
          shiftDate: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
          requestGroupId: true,
          client: {
            select: {
              id: true,
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
      serviceConfirmation: true,
    },
  });

  if (!assignment) {
    throw new ConfirmationEvidenceError(
      "ASSIGNMENT_NOT_FOUND",
      "Die angegebene Schicht (Assignment) wurde nicht gefunden.",
      404
    );
  }

  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const isAssignedWorker = assignment.worker.userId === user.id;
  const isOwningClient =
    user.role === "client" &&
    (assignment.order.client.userId === user.id ||
      (user.clientId && assignment.order.clientId === user.clientId));

  if (!isAdmin && !isAssignedWorker && !isOwningClient) {
    throw new ConfirmationEvidenceError(
      "FORBIDDEN_ASSIGNMENT_ACCESS",
      "Sie haben keine Berechtigung für diese Schicht.",
      403
    );
  }

  return assignment;
}

/**
 * Strictly validates and normalizes proposed hours.
 * Accepts numbers or strings (supports German comma notation e.g. "6,75").
 * Rejects negative hours, non-numeric strings (e.g. "6.72oops"), Infinity, and values > 24.
 * Rounds to 2 decimal places to match Decimal(5,2).
 */
export function validateAndNormalizeProposedHours(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new ConfirmationEvidenceError(
        "INVALID_PROPOSED_HOURS",
        `Ungültiges Stundenformat '${raw}'. Erwartet wird eine positive Zahl (z. B. 6.5 oder 6,50).`
      );
    }
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0 || num > 24) {
      throw new ConfirmationEvidenceError(
        "INVALID_PROPOSED_HOURS",
        `Ungültige Stundenzahl (${num}). Muss zwischen 0 und 24 liegen.`
      );
    }
    return Math.round(num * 100) / 100;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || raw > 24) {
      throw new ConfirmationEvidenceError(
        "INVALID_PROPOSED_HOURS",
        `Ungültige Stundenzahl (${raw}). Muss zwischen 0 und 24 liegen.`
      );
    }
    return Math.round(raw * 100) / 100;
  }
  throw new ConfirmationEvidenceError(
    "INVALID_PROPOSED_HOURS",
    "Ungültiger Wert für vorgeschlagene Stunden."
  );
}

/**
 * Validates shift time format (HH:MM).
 */
export function validateShiftTime(time: unknown): string | null {
  if (time === undefined || time === null) return null;
  if (typeof time !== "string") {
    throw new ConfirmationEvidenceError("INVALID_SHIFT_TIME", "Ungültiges Zeitformat.");
  }
  const trimmed = time.trim();
  if (!trimmed) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw new ConfirmationEvidenceError(
      "INVALID_SHIFT_TIME",
      `Ungültiges Uhrzeitformat '${time}'. Erwartet wird HH:MM (z. B. 08:30).`
    );
  }
  return trimmed;
}

/**
 * Validates break minutes (0 to 720 minutes).
 */
export function validateBreakMinutes(mins: unknown): number | null {
  if (mins === undefined || mins === null) return null;
  if (typeof mins === "string") {
    const trimmed = mins.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) {
      throw new ConfirmationEvidenceError("INVALID_BREAK_MINUTES", `Ungültige Pausenminuten '${mins}'.`);
    }
    const num = Number.parseInt(trimmed, 10);
    if (num < 0 || num > 720) {
      throw new ConfirmationEvidenceError("INVALID_BREAK_MINUTES", "Pausenzeit muss zwischen 0 und 720 Minuten liegen.");
    }
    return num;
  }
  if (typeof mins === "number") {
    if (!Number.isInteger(mins) || mins < 0 || mins > 720) {
      throw new ConfirmationEvidenceError("INVALID_BREAK_MINUTES", "Pausenzeit muss zwischen 0 und 720 Minuten liegen.");
    }
    return mins;
  }
  throw new ConfirmationEvidenceError("INVALID_BREAK_MINUTES", "Ungültiger Wert für Pausenminuten.");
}

/**
 * Validates file buffer constraints: size, MIME type, non-emptiness.
 */
export function validateEvidenceFile(file: EvidenceFilePayload) {
  if (!file.buffer || file.buffer.length === 0) {
    throw new ConfirmationEvidenceError("EMPTY_FILE", "Die hochgeladene Datei ist leer.");
  }

  if (file.sizeBytes > MAX_CONFIRMATION_FILE_SIZE_BYTES) {
    throw new ConfirmationEvidenceError(
      "FILE_TOO_LARGE",
      `Die Datei überschreitet die maximale Größe von 25 MB (Aktuell: ${(file.sizeBytes / 1024 / 1024).toFixed(2)} MB).`
    );
  }

  const cleanMime = file.mimeType.toLowerCase().split(";")[0].trim();
  if (!ALLOWED_CONFIRMATION_MIME_TYPES.has(cleanMime)) {
    throw new ConfirmationEvidenceError(
      "UNSUPPORTED_MIME_TYPE",
      `Nicht unterstützter Dateityp '${file.mimeType}'. Erlaubt sind PDF, JPEG, PNG und WebP.`
    );
  }

  const detected = detectMimeTypeFromBuffer(file.buffer);
  if (!detected || detected !== cleanMime) {
    throw new ConfirmationEvidenceError(
      "UNSUPPORTED_MIME_TYPE",
      `Ungültiger oder nicht unterstützter Dateiinhalt. Die Datei entspricht keinem echten ${cleanMime}-Format.`
    );
  }
}

/**
 * Core Service: Adds an evidence document to an assignment without erasing or overwriting
 * previous electronic signatures or original confirmation records.
 *
 * Guarantees:
 * 1. upsert: false on storage upload.
 * 2. Immutable preservation of existing ServiceConfirmation.signatureData and method.
 * 3. Atomic registration of ConfirmationDocument.
 * 4. Distinct tracking of proposed vs approved hours without mutating invoice snapshotData.
 */
export async function addConfirmationEvidence(params: AddEvidenceParams) {
  const {
    assignmentId,
    file,
    proposedHours,
    proposedStartTime,
    proposedEndTime,
    proposedBreakMinutes,
    correctionReason,
    signerName,
    signerIp,
    signatureData,
    currentUser,
    requestGroupId,
  } = params;

  // Strict pre-validation: reject invalid hours, times, or breaks BEFORE any storage upload or DB writes
  const validatedProposedHours = validateAndNormalizeProposedHours(proposedHours);
  const validatedStartTime = validateShiftTime(proposedStartTime);
  const validatedEndTime = validateShiftTime(proposedEndTime);
  const validatedBreakMinutes = validateBreakMinutes(proposedBreakMinutes);

  const assignment = await assertAssignmentAccess(assignmentId, currentUser);
  const now = new Date();

  let storagePath = params.storagePath || null;
  let fileHash = params.fileHash || null;
  let uploadedToStorage = false;
  const fileName = file ? sanitizeFileName(file.fileName) : null;
  const mimeType = file ? file.mimeType.toLowerCase().split(";")[0].trim() : null;
  const fileSizeBytes = file ? file.sizeBytes : null;

  // 1. Process and upload physical file if provided
  if (file) {
    validateEvidenceFile(file);
    fileHash = computeFileSha256(file.buffer);

    // Duplicate upload guard: prevent duplicate writes if identical file already exists for this assignment
    const existingSameDoc = await prisma.confirmationDocument.findFirst({
      where: {
        assignmentId,
        fileHash,
      },
    });

    if (existingSameDoc) {
      throw new ConfirmationEvidenceError(
        "DUPLICATE_DOCUMENT",
        "Dieses Dokument wurde für diese Schicht bereits hochgeladen.",
        409
      );
    }

    const randomSlug = crypto.randomBytes(6).toString("hex");
    const safeName = sanitizeFileName(file.fileName);
    storagePath = `signed-confirmations/${assignment.order.clientId}/${assignmentId}/${Date.now()}-${randomSlug}-${safeName}`;

    const supabase = createSupabaseAdminClient();
    const { error: uploadError } = await supabase.storage
      .from("confirmations")
      .upload(storagePath, file.buffer, {
        contentType: mimeType || "application/pdf",
        upsert: false, // Strict: never overwrite existing files in storage
      });

    if (uploadError) {
      throw new ConfirmationEvidenceError(
        "STORAGE_UPLOAD_FAILED",
        `Fehler beim Hochladen der Datei ins Speichersystem: ${uploadError.message}`,
        500
      );
    }
    uploadedToStorage = true;
  }

  // 2. Determine source type
  let sourceType: ConfirmationDocumentSourceType =
    params.sourceType ||
    (assignment.serviceConfirmation
      ? assignment.serviceConfirmation.method === "electronic"
        ? "manual_correction"
        : "manual_correction"
      : "manual_upload");

  if (!file && signatureData) {
    sourceType = "electronic_original";
  }

  // 3. Database persistence inside atomic transaction
  try {
    return await prisma.$transaction(async (tx) => {
    // A. Create ConfirmationDocument record
    const doc = await tx.confirmationDocument.create({
      data: {
        assignmentId,
        sourceType,
        storagePath,
        fileHash,
        fileName,
        mimeType,
        fileSizeBytes,
        signatureData: signatureData || null,
        signerName: signerName || null,
        signerIp: signerIp || null,
        uploadedById: currentUser.id,
        uploaderRole: currentUser.role,
        metadata: {
          clientNotes: params.clientNotes || null,
          requestGroupId: requestGroupId || assignment.order.requestGroupId || null,
        },
        createdAt: now,
      },
    });

    // B. Handle ServiceConfirmation state
    let correctionRequest = null;
    const existingSc = assignment.serviceConfirmation;

    if (existingSc) {
      // PRESERVATION INVARIANT: If existing confirmation was electronic or previously confirmed,
      // DO NOT OVERWRITE its method, signatureData, confirmedAt, signerName, or hoursWorked!
      // If proposed hours are supplied and differ from current hoursWorked, register a proposed correction.
      if (
        validatedProposedHours !== undefined &&
        Number(existingSc.hoursWorked) !== validatedProposedHours
      ) {
        correctionRequest = await tx.workHoursCorrectionRequest.create({
          data: {
            assignmentId,
            documentId: doc.id,
            status: "proposed",
            previousHoursWorked: existingSc.hoursWorked,
            proposedHoursWorked: validatedProposedHours,
            proposedStartTime: validatedStartTime ?? null,
            proposedEndTime: validatedEndTime ?? null,
            proposedBreakMinutes: validatedBreakMinutes ?? null,
            reason: correctionReason || params.clientNotes || "Korrekturbeleg eingereicht",
            requestedById: currentUser.id,
            requestedAt: now,
          },
        });
      }
    } else {
      // INITIAL MANUAL CONFIRMATION: No prior record exists.
      // Create ServiceConfirmation with method: "upload" so scheduling status advances normally.
      const initialHours =
        validatedProposedHours !== undefined
          ? validatedProposedHours
          : netShiftHours(
              assignment.order.startTime,
              assignment.order.endTime,
              assignment.order.breakMinutes
            );

      await tx.serviceConfirmation.create({
        data: {
          assignmentId,
          confirmedById: currentUser.id,
          method: "upload",
          documentUrl: storagePath,
          hoursWorked: initialHours,
          signerName: signerName || "Manuell signiert",
          clientNotes: params.clientNotes || "Manuell signierter Leistungsnachweis",
          ipAddress: signerIp || "unknown",
          confirmedAt: now,
        },
      });
    }

    return {
      document: doc,
      correctionRequest,
    };
  });
  } catch (dbErr: unknown) {
    if (uploadedToStorage && storagePath) {
      try {
        const supabase = createSupabaseAdminClient();
        await supabase.storage.from("confirmations").remove([storagePath]);
      } catch (cleanupErr) {
        console.error("Failed to clean up orphaned storage file after DB failure:", cleanupErr);
      }
    }

    const errorMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
    const errorCode = (dbErr as { code?: string })?.code;
    const meta = (dbErr as { meta?: { target?: string[] | string } })?.meta;
    const isDocUniqueError =
      (errorCode === "P2002" && (
        Array.isArray(meta?.target)
          ? meta.target.includes("fileHash") || meta.target.includes("file_hash")
          : typeof meta?.target === "string"
            ? meta.target.includes("file_hash") || meta.target.includes("fileHash") || meta.target.includes("confirmation_documents")
            : false
      )) ||
      errorMessage.includes("confirmation_documents_assignment_id_file_hash_key") ||
      errorMessage.includes("(`assignment_id`,`file_hash`)");

    if (isDocUniqueError) {
      throw new ConfirmationEvidenceError(
        "DUPLICATE_DOCUMENT",
        "Dieses Dokument wurde für diese Schicht bereits hochgeladen.",
        409
      );
    }

    throw dbErr;
  }
}

/**
 * Retrieves the full evidence history and timeline for an assignment.
 * Implements compatible retro-active reading for legacy records:
 * - Legacy electronic confirmations without an archived PDF are clearly tagged as dynamically rendered.
 * - Electronic originals, manual uploads, and manual corrections appear as distinct records.
 */
export async function getAssignmentEvidenceHistory(
  assignmentId: string,
  currentUser: { id: string; role: string; clientId?: string | null }
): Promise<EvidenceTimeline> {
  const assignment = await assertAssignmentAccess(assignmentId, currentUser);

  const docs = await prisma.confirmationDocument.findMany({
    where: { assignmentId },
    orderBy: { createdAt: "asc" },
  });

  const pendingCorrection = await prisma.workHoursCorrectionRequest.findFirst({
    where: {
      assignmentId,
      status: "proposed",
    },
    orderBy: { requestedAt: "desc" },
  });

  const scheduledHours = netShiftHours(
    assignment.order.startTime,
    assignment.order.endTime,
    assignment.order.breakMinutes
  );

  const sc = assignment.serviceConfirmation;
  const legacyBaseline = sc
    ? {
        exists: true,
        method: sc.method as "electronic" | "upload",
        hoursWorked: sc.hoursWorked ? Number(sc.hoursWorked) : null,
        hasArchivedPdf: Boolean(sc.method === "electronic" && sc.documentUrl?.includes("/signed/")),
        isDynamicallyGeneratedView: Boolean(
          sc.method === "electronic" && !sc.documentUrl?.includes("/signed/")
        ),
        hasSignatureImage: Boolean(sc.signatureData),
        signerName: sc.signerName,
        confirmedAt: sc.confirmedAt.toISOString(),
      }
    : null;

  // Format documents with explicit artifact classification
  const documentViews: EvidenceDocumentView[] = docs.map((d) => {
    const isArchivedPdf = Boolean(
      d.sourceType === "electronic_original" && d.storagePath && d.mimeType === "application/pdf"
    );
    const isPhysicalScan = Boolean(
      (d.sourceType === "manual_upload" || d.sourceType === "manual_correction") && d.storagePath
    );
    const isDynamicallyGeneratedView = Boolean(
      d.sourceType === "electronic_original" && !d.storagePath && d.signatureData
    );

    return {
      id: d.id,
      assignmentId: d.assignmentId,
      sourceType: d.sourceType,
      storagePath: d.storagePath,
      fileHash: d.fileHash,
      fileName: d.fileName,
      mimeType: d.mimeType,
      fileSizeBytes: d.fileSizeBytes,
      signatureData: d.signatureData,
      signerName: d.signerName,
      signerIp: d.signerIp,
      uploadedById: d.uploadedById,
      uploaderRole: d.uploaderRole,
      createdAt: d.createdAt.toISOString(),
      metadata: (d.metadata as Record<string, unknown>) || null,
      isArchivedPdf,
      isDynamicallyGeneratedView,
      isPhysicalScan,
    };
  });

  // Surface the legacy baseline original if a legacy ServiceConfirmation exists
  // AND there is no modern ConfirmationDocument row that already represents the original electronic signature.
  // This ensures the original remains visible EVEN AFTER subsequent manual sheets or corrections are uploaded!
  const hasModernOriginal = docs.some((d) => d.sourceType === "electronic_original");
  if (sc && !hasModernOriginal) {
    const isArchivedPdf = Boolean(sc.method === "electronic" && sc.documentUrl?.includes("/signed/"));
    const isPhysicalScan = Boolean(sc.method === "upload" && sc.documentUrl);
    const isDynamicallyGeneratedView = Boolean(
      sc.method === "electronic" && !sc.documentUrl?.includes("/signed/")
    );

    documentViews.unshift({
      id: `legacy-${sc.id}`,
      assignmentId: sc.assignmentId,
      sourceType: sc.method === "electronic" ? "electronic_original" : "manual_upload",
      storagePath: sc.documentUrl,
      fileHash: null,
      fileName: sc.documentUrl ? sc.documentUrl.split("/").pop() || null : (sc.signatureData ? "electronic-signature.png" : null),
      mimeType: isPhysicalScan ? "application/pdf" : sc.method === "electronic" ? (sc.documentUrl ? "application/pdf" : "image/png") : null,
      fileSizeBytes: null,
      signatureData: sc.signatureData,
      signerName: sc.signerName,
      signerIp: sc.ipAddress,
      uploadedById: sc.confirmedById,
      uploaderRole: sc.method === "electronic" ? "client" : "admin",
      createdAt: sc.confirmedAt.toISOString(),
      metadata: { clientNotes: sc.clientNotes, isSynthesizedLegacyBaseline: true },
      isArchivedPdf,
      isDynamicallyGeneratedView,
      isPhysicalScan,
    });
  }

  return {
    assignmentId: assignment.id,
    orderId: assignment.order.id,
    workerId: assignment.worker.id,
    workerName: assignment.worker.fullName,
    clientId: assignment.order.clientId,
    facilityName: assignment.order.client.facilityName,
    shiftDate: assignment.order.shiftDate.toISOString().slice(0, 10),
    scheduledHours,
    currentApprovedHours: sc?.hoursWorked ? Number(sc.hoursWorked) : null,
    currentMethod: sc ? (sc.method as "electronic" | "upload") : null,
    legacyConfirmation: legacyBaseline,
    legacyBaseline,
    documents: documentViews,
    pendingCorrection: pendingCorrection
      ? {
          id: pendingCorrection.id,
          status: pendingCorrection.status,
          previousHoursWorked: pendingCorrection.previousHoursWorked
            ? Number(pendingCorrection.previousHoursWorked)
            : null,
          proposedHoursWorked: Number(pendingCorrection.proposedHoursWorked),
          proposedStartTime: pendingCorrection.proposedStartTime,
          proposedEndTime: pendingCorrection.proposedEndTime,
          proposedBreakMinutes: pendingCorrection.proposedBreakMinutes,
          reason: pendingCorrection.reason,
          requestedAt: pendingCorrection.requestedAt.toISOString(),
          requestedById: pendingCorrection.requestedById,
        }
      : null,
  };
}
