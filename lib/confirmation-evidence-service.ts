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
  intent?: "attach_evidence" | "initial_confirmation";
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
  storagePath?: string | null;
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
  correctionStatus?: HoursCorrectionStatus | null;
  isCorrectionApproved?: boolean;
};

export type CorrectionRecordView = {
  id: string;
  documentId: string | null;
  baseVersion: string | null;
  revision: number;
  status: HoursCorrectionStatus;
  previousHoursWorked: number | null;
  proposedHoursWorked: number;
  proposedStartTime: string | null;
  proposedEndTime: string | null;
  proposedBreakMinutes: number | null;
  reason: string | null;
  requestedAt: string;
  requestedById: string | null;
  decidedAt: string | null;
  decidedById: string | null;
  decisionNote: string | null;
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
  effectiveWorkHours: number;
  effectiveStartTime: string;
  effectiveEndTime: string;
  effectiveBreakMinutes: number;
  effectiveSource: "approved_correction" | "service_confirmation" | "scheduled";
  effectiveVersion: string;
  isCorrected: boolean;
  approvedCorrection: CorrectionRecordView | null;
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
  pendingCorrection: CorrectionRecordView | null;
  corrections: CorrectionRecordView[];
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
 * Parses "HH:mm" time string into total minutes since midnight (0 to 1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  const validated = validateShiftTime(timeStr);
  if (!validated) {
    throw new ConfirmationEvidenceError("INVALID_SHIFT_TIME", "Uhrzeit darf nicht leer sein.");
  }
  const [hStr, mStr] = validated.split(":");
  return Number.parseInt(hStr, 10) * 60 + Number.parseInt(mStr, 10);
}

/**
 * Computes gross shift minutes between start and end time.
 * Handles crossing midnight correctly (e.g., 22:00 to 06:00 => 480 minutes).
 */
export function computeShiftGrossMinutes(startTime: string, endTime: string): number {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (endMin > startMin) {
    return endMin - startMin;
  }
  if (endMin < startMin) {
    return 1440 - startMin + endMin;
  }
  return 0;
}

/**
 * Computes net shift hours rounded to 2 decimal places:
 * Math.round(((grossMinutes - breakMinutes) / 60) * 100) / 100
 */
export function computeShiftNetHours(
  startTime: string,
  endTime: string,
  breakMinutes: number
): number {
  const gross = computeShiftGrossMinutes(startTime, endTime);
  if (gross <= 0) {
    throw new ConfirmationEvidenceError(
      "INVALID_SHIFT_TIME",
      "Beginn und Ende müssen eine positive Schichtdauer ergeben."
    );
  }
  const validBreak = validateBreakMinutes(breakMinutes);
  const breakMin = validBreak ?? 0;
  if (breakMin >= gross) {
    throw new ConfirmationEvidenceError(
      "INVALID_BREAK_MINUTES",
      "Die Pausenzeit darf nicht größer oder gleich der gesamten Schichtdauer sein."
    );
  }
  const netMin = gross - breakMin;
  return Math.round((netMin / 60) * 100) / 100;
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
      const intent = params.intent || "attach_evidence";
      if (intent === "initial_confirmation") {
        // INITIAL MANUAL CONFIRMATION: Explicit initial manual confirmation intent.
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
      } else {
        // intent === "attach_evidence" (default):
        // Strict Phase 3b/3c requirement: Attaching evidence to an unconfirmed shift
        // stores the ConfirmationDocument ONLY, and NEVER creates an implicit ServiceConfirmation!
        if (validatedProposedHours !== undefined) {
          correctionRequest = await tx.workHoursCorrectionRequest.create({
            data: {
              assignmentId,
              documentId: doc.id,
              status: "proposed",
              previousHoursWorked: null,
              proposedHoursWorked: validatedProposedHours,
              proposedStartTime: validatedStartTime ?? null,
              proposedEndTime: validatedEndTime ?? null,
              proposedBreakMinutes: validatedBreakMinutes ?? null,
              reason: correctionReason || params.clientNotes || "Stundennachweis eingereicht",
              requestedById: currentUser.id,
              requestedAt: now,
            },
          });
        }
      }
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

export type EffectiveAssignmentWorkHours = {
  assignmentId: string;
  effectiveHours: number;
  effectiveStartTime: string;
  effectiveEndTime: string;
  effectiveBreakMinutes: number;
  source: "approved_correction" | "service_confirmation" | "scheduled";
  effectiveVersion: string;
  isCorrected: boolean;
  baselineHours: number | null;
  approvedCorrection: CorrectionRecordView | null;
};

export type ProposeHoursCorrectionParams = {
  assignmentId: string;
  documentId: string;
  expectedEffectiveVersion: string;
  expectedBaselineHours?: number | null;
  proposedHours?: number | string;
  proposedStartTime?: string | null;
  proposedEndTime?: string | null;
  proposedBreakMinutes?: number | string | null;
  reason?: string | null;
  currentUser: {
    id: string;
    role: string;
    clientId?: string | null;
  };
};

export type ApproveHoursCorrectionParams = {
  correctionRequestId: string;
  expectedEffectiveVersion: string;
  effectiveStartTime?: string | null;
  effectiveEndTime?: string | null;
  effectiveBreakMinutes?: number | string | null;
  decisionNote?: string | null;
  currentUser: {
    id: string;
    role: string;
  };
  decidedAt?: Date;
};

export type RejectHoursCorrectionParams = {
  correctionRequestId: string;
  expectedEffectiveVersion?: string | null;
  decisionNote?: string | null;
  currentUser: {
    id: string;
    role: string;
  };
};

export function computeAssignmentEffectiveVersion(
  assignmentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  latestApprovedCorrection: any | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceConfirmation: any | null,
  orderOrOrderId:
    | string
    | {
        id: string;
        startTime?: string | null;
        endTime?: string | null;
        breakMinutes?: number | null;
      },
  orderTimesFallback?: {
    startTime: string;
    endTime: string;
    breakMinutes: number;
  }
): string {
  const orderId = typeof orderOrOrderId === "string" ? orderOrOrderId : orderOrOrderId.id;
  const orderStart =
    (typeof orderOrOrderId === "object" && orderOrOrderId.startTime) ||
    orderTimesFallback?.startTime ||
    "";
  const orderEnd =
    (typeof orderOrOrderId === "object" && orderOrOrderId.endTime) ||
    orderTimesFallback?.endTime ||
    "";
  const orderBreak =
    (typeof orderOrOrderId === "object" && orderOrOrderId.breakMinutes != null)
      ? Number(orderOrOrderId.breakMinutes)
      : (orderTimesFallback?.breakMinutes ?? 0);

  if (latestApprovedCorrection) {
    const rev = latestApprovedCorrection.revision ?? 1;
    const hours = Number(latestApprovedCorrection.proposedHoursWorked).toFixed(2);
    const start = latestApprovedCorrection.proposedStartTime || "";
    const end = latestApprovedCorrection.proposedEndTime || "";
    const brk = latestApprovedCorrection.proposedBreakMinutes ?? 0;
    const docId = latestApprovedCorrection.documentId || "";
    const baseVer = latestApprovedCorrection.baseVersion || "";
    const payload = `corr|${latestApprovedCorrection.id}|r${rev}|${hours}|${start}|${end}|${brk}|${docId}|${baseVer}`;
    const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
    return `corr:${latestApprovedCorrection.id}:r${rev}:${hash}`;
  }

  if (serviceConfirmation) {
    const hours =
      serviceConfirmation.hoursWorked != null
        ? Number(serviceConfirmation.hoursWorked).toFixed(2)
        : "";
    const doc = serviceConfirmation.documentUrl || "";
    const method = serviceConfirmation.method || "";
    const confirmedTime = serviceConfirmation.confirmedAt
      ? new Date(serviceConfirmation.confirmedAt).getTime()
      : 0;
    const payload = `sc|${serviceConfirmation.id}|${confirmedTime}|${hours}|${orderStart}|${orderEnd}|${orderBreak}|${doc}|${method}`;
    const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
    return `sc:${serviceConfirmation.id}:${hash}`;
  }

  const scheduledNet = (orderStart && orderEnd)
    ? netShiftHours(orderStart, orderEnd, orderBreak).toFixed(2)
    : "0.00";
  const payload = `sched|${orderId}|${orderStart}|${orderEnd}|${orderBreak}|${scheduledNet}`;
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
  return `scheduled:${orderId}:${hash}`;
}

/**
 * Central Read Model: Resolves effective work hours per Assignment.
 *
 * Invariant Hierarchy:
 * 1. Approved correction request (status: "approved") => uses approved hours, times, and break.
 * 2. ServiceConfirmation => uses historical hoursWorked and scheduled order times.
 * 3. Scheduled shift => uses netShiftHours(order.startTime, order.endTime, order.breakMinutes).
 *
 * Isolation guarantee: strictly assignment-scoped. Does NOT modify or inspect invoices or order-level shared times.
 */
export async function getAssignmentEffectiveWorkHours(
  assignmentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientOrTx: any = prisma
): Promise<EffectiveAssignmentWorkHours> {
  const assignment = await clientOrTx.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      order: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          breakMinutes: true,
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
          documentUrl: true,
        },
      },
    },
  });

  if (!assignment) {
    throw new ConfirmationEvidenceError(
      "ASSIGNMENT_NOT_FOUND",
      "Die angegebene Schicht wurde nicht gefunden.",
      404
    );
  }

  // Find latest approved correction ordered by causal database revision first,
  // followed by decidedAt, requestedAt, and id. Completely immune to app-server clock skew.
  const approvedCorrection = await clientOrTx.workHoursCorrectionRequest.findFirst({
    where: {
      assignmentId,
      status: "approved",
    },
    orderBy: [
      { revision: "desc" },
      { decidedAt: "desc" },
      { requestedAt: "desc" },
      { id: "desc" },
    ],
  });

  const scheduledHours = netShiftHours(
    assignment.order.startTime,
    assignment.order.endTime,
    assignment.order.breakMinutes
  );

  const baselineHours =
    assignment.serviceConfirmation?.hoursWorked != null
      ? Number(assignment.serviceConfirmation.hoursWorked)
      : scheduledHours;

  const effectiveVersion = computeAssignmentEffectiveVersion(
    assignmentId,
    approvedCorrection,
    assignment.serviceConfirmation,
    assignment.order
  );

  if (approvedCorrection) {
    return {
      assignmentId,
      effectiveHours: Number(approvedCorrection.proposedHoursWorked),
      effectiveStartTime: approvedCorrection.proposedStartTime || assignment.order.startTime,
      effectiveEndTime: approvedCorrection.proposedEndTime || assignment.order.endTime,
      effectiveBreakMinutes:
        approvedCorrection.proposedBreakMinutes ?? assignment.order.breakMinutes,
      source: "approved_correction",
      effectiveVersion,
      isCorrected: true,
      baselineHours,
      approvedCorrection: {
        id: approvedCorrection.id,
        documentId: approvedCorrection.documentId,
        baseVersion: approvedCorrection.baseVersion || null,
        revision: approvedCorrection.revision ?? 1,
        status: approvedCorrection.status,
        previousHoursWorked:
          approvedCorrection.previousHoursWorked != null
            ? Number(approvedCorrection.previousHoursWorked)
            : null,
        proposedHoursWorked: Number(approvedCorrection.proposedHoursWorked),
        proposedStartTime: approvedCorrection.proposedStartTime,
        proposedEndTime: approvedCorrection.proposedEndTime,
        proposedBreakMinutes: approvedCorrection.proposedBreakMinutes,
        reason: approvedCorrection.reason,
        requestedById: approvedCorrection.requestedById,
        requestedAt: approvedCorrection.requestedAt.toISOString(),
        decidedById: approvedCorrection.decidedById,
        decidedAt: approvedCorrection.decidedAt
          ? approvedCorrection.decidedAt.toISOString()
          : null,
        decisionNote: approvedCorrection.decisionNote,
      },
    };
  }

  if (assignment.serviceConfirmation?.hoursWorked != null) {
    return {
      assignmentId,
      effectiveHours: Number(assignment.serviceConfirmation.hoursWorked),
      effectiveStartTime: assignment.order.startTime,
      effectiveEndTime: assignment.order.endTime,
      effectiveBreakMinutes: assignment.order.breakMinutes,
      source: "service_confirmation",
      effectiveVersion,
      isCorrected: false,
      baselineHours,
      approvedCorrection: null,
    };
  }

  return {
    assignmentId,
    effectiveHours: scheduledHours,
    effectiveStartTime: assignment.order.startTime,
    effectiveEndTime: assignment.order.endTime,
    effectiveBreakMinutes: assignment.order.breakMinutes,
    source: "scheduled",
    effectiveVersion,
    isCorrected: false,
    baselineHours,
    approvedCorrection: null,
  };
}

/**
 * Server Operation 1: Creates or updates an explicit hours correction proposal
 * linked to an existing ConfirmationDocument on this assignment.
 */
export async function createOrUpdateHoursCorrectionRequest(
  params: ProposeHoursCorrectionParams
) {
  const isAdmin =
    params.currentUser.role === "admin" || params.currentUser.role === "super_admin";
  if (!isAdmin) {
    throw new ConfirmationEvidenceError(
      "FORBIDDEN",
      "Nur Administratoren dürfen Stundenkorrekturen vorschlagen.",
      403
    );
  }

  await assertAssignmentAccess(params.assignmentId, params.currentUser);

  // Validate document existence and assignment boundary
  const doc = await prisma.confirmationDocument.findUnique({
    where: { id: params.documentId },
  });
  if (!doc) {
    throw new ConfirmationEvidenceError(
      "DOCUMENT_NOT_FOUND",
      "Das angegebene Dokument wurde nicht gefunden.",
      404
    );
  }
  if (doc.assignmentId !== params.assignmentId) {
    throw new ConfirmationEvidenceError(
      "DOCUMENT_ASSIGNMENT_MISMATCH",
      "Das ausgewählte Dokument gehört nicht zu dieser Schicht.",
      400
    );
  }

  // Time & break validation
  const startTime = validateShiftTime(params.proposedStartTime);
  const endTime = validateShiftTime(params.proposedEndTime);
  const breakMinutes = validateBreakMinutes(params.proposedBreakMinutes);
  let proposedHours = validateAndNormalizeProposedHours(params.proposedHours);

  if (startTime && endTime) {
    const grossMinutes = computeShiftGrossMinutes(startTime, endTime);
    if (grossMinutes <= 0) {
      throw new ConfirmationEvidenceError(
        "INVALID_SHIFT_TIME",
        "Beginn und Ende müssen eine positive Schichtdauer ergeben.",
        400
      );
    }
    if (breakMinutes !== null) {
      if (breakMinutes >= grossMinutes) {
        throw new ConfirmationEvidenceError(
          "INVALID_BREAK_MINUTES",
          "Die Pause darf nicht größer oder gleich der Schichtdauer sein.",
          400
        );
      }
      const calcNet = computeShiftNetHours(startTime, endTime, breakMinutes);
      if (proposedHours === undefined) {
        proposedHours = calcNet;
      } else if (Math.abs(calcNet - proposedHours) > 0.01) {
        throw new ConfirmationEvidenceError(
          "HOURS_TIME_MISMATCH",
          `Die vorgeschlagenen Stunden (${proposedHours}) stimmen nicht mit den Zeitangaben überein (${calcNet} Std).`,
          400
        );
      }
    }
  }

  if (proposedHours === undefined) {
    throw new ConfirmationEvidenceError(
      "INVALID_PROPOSED_HOURS",
      "Vorgeschlagene Stunden müssen angegeben werden oder aus Beginn, Ende und Pause berechnet werden können.",
      400
    );
  }

  if (
    !params.expectedEffectiveVersion ||
    typeof params.expectedEffectiveVersion !== "string" ||
    !params.expectedEffectiveVersion.trim()
  ) {
    throw new ConfirmationEvidenceError(
      "MISSING_VERSION_TOKEN",
      "Der Versionsbezeichner (expectedEffectiveVersion) ist für die Prüfung zwingend erforderlich.",
      400
    );
  }

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Resolve current effective baseline inside transaction
    const currentEffective = await getAssignmentEffectiveWorkHours(params.assignmentId, tx);
    const currentBaselineHours = currentEffective.effectiveHours;

    // 2. Strict Version validation: reject if client expected a different version token
    if (currentEffective.effectiveVersion !== params.expectedEffectiveVersion.trim()) {
      throw new ConfirmationEvidenceError(
        "CONCURRENT_MODIFICATION_CONFLICT",
        `Die Basis-Version der Schicht wurde zwischenzeitlich geändert (Erwartet: '${params.expectedEffectiveVersion.trim()}', Aktuell: '${currentEffective.effectiveVersion}'). Bitte laden Sie die Schicht neu.`,
        409
      );
    }

    // 3. Optimistic baseline hours validation (secondary safeguard)
    if (
      params.expectedBaselineHours !== undefined &&
      params.expectedBaselineHours !== null &&
      Math.abs(Number(params.expectedBaselineHours) - currentBaselineHours) > 0.001
    ) {
      throw new ConfirmationEvidenceError(
        "CONCURRENT_MODIFICATION_CONFLICT",
        `Die Basis-Stunden der Schicht wurden zwischenzeitlich geändert (Erwartet: ${params.expectedBaselineHours} Std, Aktuell: ${currentBaselineHours} Std). Bitte laden Sie die Schicht neu.`,
        409
      );
    }

    // 4. Check if there is an existing pending request
    const existingPending = await tx.workHoursCorrectionRequest.findFirst({
      where: {
        assignmentId: params.assignmentId,
        status: "proposed",
      },
    });

    if (existingPending) {
      return await tx.workHoursCorrectionRequest.update({
        where: { id: existingPending.id },
        data: {
          documentId: doc.id,
          baseVersion: currentEffective.effectiveVersion,
          previousHoursWorked: currentBaselineHours,
          proposedHoursWorked: proposedHours,
          proposedStartTime: startTime ?? null,
          proposedEndTime: endTime ?? null,
          proposedBreakMinutes: breakMinutes ?? null,
          reason: params.reason?.trim() || null,
          requestedById: params.currentUser.id,
          requestedAt: now,
        },
      });
    }

    return await tx.workHoursCorrectionRequest.create({
      data: {
        assignmentId: params.assignmentId,
        documentId: doc.id,
        baseVersion: currentEffective.effectiveVersion,
        status: "proposed",
        previousHoursWorked: currentBaselineHours,
        proposedHoursWorked: proposedHours,
        proposedStartTime: startTime ?? null,
        proposedEndTime: endTime ?? null,
        proposedBreakMinutes: breakMinutes ?? null,
        reason: params.reason?.trim() || null,
        requestedById: params.currentUser.id,
        requestedAt: now,
      },
    });
  });
}

/**
 * Server Operation 2: Explicitly approves a proposed hours correction request.
 *
 * Invariants:
 * - Requires admin authorization.
 * - Rejects already decided requests (ALREADY_DECIDED).
 * - Atomic DB conditional transition: updateMany with { id, status: "proposed" } and count === 1.
 * - Enforces single approved correction per assignment, preventing concurrent duplicate approvals.
 * - Requires supporting document matching the assignment.
 * - Checks that no newer approved request exists (STALE_CORRECTION_REQUEST).
 * - Mandates explicit digital time details (start, end, break) at approval time.
 * - Validates consistency between digital times and approved hours.
 * - Leaves ServiceConfirmation, original electronic signatures, and invoices completely untouched.
 */
export async function approveHoursCorrectionRequest(
  params: ApproveHoursCorrectionParams
) {
  const isAdmin =
    params.currentUser.role === "admin" || params.currentUser.role === "super_admin";
  if (!isAdmin) {
    throw new ConfirmationEvidenceError(
      "FORBIDDEN",
      "Nur Administratoren dürfen Stundenkorrekturen genehmigen.",
      403
    );
  }

  if (
    !params.expectedEffectiveVersion ||
    typeof params.expectedEffectiveVersion !== "string" ||
    !params.expectedEffectiveVersion.trim()
  ) {
    throw new ConfirmationEvidenceError(
      "MISSING_VERSION_TOKEN",
      "Der Versionsbezeichner (expectedEffectiveVersion) ist für die Genehmigung zwingend erforderlich.",
      400
    );
  }

  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const request = await tx.workHoursCorrectionRequest.findUnique({
        where: { id: params.correctionRequestId },
        include: {
          assignment: {
            include: {
              order: true,
              serviceConfirmation: true,
            },
          },
          document: true,
        },
      });

      if (!request) {
        throw new ConfirmationEvidenceError(
          "CORRECTION_REQUEST_NOT_FOUND",
          "Der angegebene Korrekturantrag wurde nicht gefunden.",
          404
        );
      }

      if (request.status === "approved") {
        throw new ConfirmationEvidenceError(
          "ALREADY_DECIDED",
          "Dieser Korrekturantrag wurde bereits genehmigt.",
          409
        );
      }
      if (request.status === "rejected") {
        throw new ConfirmationEvidenceError(
          "ALREADY_DECIDED",
          "Dieser Korrekturantrag wurde bereits abgelehnt.",
          409
        );
      }

      // Document safety: must exist and match assignment
      if (!request.document) {
        throw new ConfirmationEvidenceError(
          "DOCUMENT_NOT_FOUND",
          "Dem Antrag ist kein gültiges Belegdokument zugeordnet.",
          400
        );
      }
      if (request.document.assignmentId !== request.assignmentId) {
        throw new ConfirmationEvidenceError(
          "DOCUMENT_ASSIGNMENT_MISMATCH",
          "Das zugeordnete Belegdokument gehört zu einer anderen Schicht.",
          400
        );
      }

      // 1. Version Verification: resolve current effective work hours inside transaction
      const currentEffective = await getAssignmentEffectiveWorkHours(request.assignmentId, tx);

      if (currentEffective.effectiveVersion !== params.expectedEffectiveVersion.trim()) {
        throw new ConfirmationEvidenceError(
          "CONCURRENT_MODIFICATION_CONFLICT",
          `Die Basis-Version der Schicht wurde zwischenzeitlich geändert (Erwartet: '${params.expectedEffectiveVersion.trim()}', Aktuell: '${currentEffective.effectiveVersion}'). Bitte laden Sie die Schicht neu.`,
          409
        );
      }

      if (request.baseVersion && request.baseVersion !== currentEffective.effectiveVersion) {
        throw new ConfirmationEvidenceError(
          "STALE_BASELINE_CONFLICT",
          "Dieser Korrekturantrag wurde auf einer veralteten Basis-Version erstellt und kann nicht genehmigt werden.",
          409
        );
      }

      // 2. Stale check: check if a newer approved request exists
      const newerApproved = await tx.workHoursCorrectionRequest.findFirst({
        where: {
          assignmentId: request.assignmentId,
          status: "approved",
          decidedAt: {
            gt: request.requestedAt,
          },
        },
      });
      if (newerApproved) {
        throw new ConfirmationEvidenceError(
          "STALE_CORRECTION_REQUEST",
          "Es existiert bereits eine neuere genehmigte Korrektur für diese Schicht.",
          409
        );
      }

      // Guard against concurrent competing approvals from the SAME base version
      const competingApproved = await tx.workHoursCorrectionRequest.findFirst({
        where: {
          assignmentId: request.assignmentId,
          status: "approved",
          baseVersion: currentEffective.effectiveVersion,
          id: { not: request.id },
        },
      });
      if (competingApproved) {
        throw new ConfirmationEvidenceError(
          "CONCURRENT_DECISION_CONFLICT",
          "Es wurde bereits eine Korrektur für dieselbe Basis-Version genehmigt.",
          409
        );
      }

      // Mandatory digital time details: start, end, break must be resolved at approval time!
      const startTimeRaw = params.effectiveStartTime || request.proposedStartTime;
      const endTimeRaw = params.effectiveEndTime || request.proposedEndTime;
      const breakMinutesRaw =
        params.effectiveBreakMinutes !== undefined && params.effectiveBreakMinutes !== null
          ? params.effectiveBreakMinutes
          : request.proposedBreakMinutes;

      const startTime = validateShiftTime(startTimeRaw);
      const endTime = validateShiftTime(endTimeRaw);
      const breakMinutes = validateBreakMinutes(breakMinutesRaw);

      if (!startTime || !endTime || breakMinutes === null) {
        throw new ConfirmationEvidenceError(
          "MISSING_TIME_DETAILS",
          "Beginn, Ende und Pausenzeit sind für die Genehmigung zwingend erforderlich.",
          400
        );
      }

      const grossMinutes = computeShiftGrossMinutes(startTime, endTime);
      if (grossMinutes <= 0) {
        throw new ConfirmationEvidenceError(
          "INVALID_SHIFT_TIME",
          "Beginn und Ende müssen eine positive Schichtdauer ergeben.",
          400
        );
      }

      if (breakMinutes >= grossMinutes) {
        throw new ConfirmationEvidenceError(
          "INVALID_BREAK_MINUTES",
          "Die Pausenzeit darf nicht größer oder gleich der gesamten Schichtdauer sein.",
          400
        );
      }

      const computedNet = computeShiftNetHours(startTime, endTime, breakMinutes);
      const proposedHours = Number(request.proposedHoursWorked);

      if (Math.abs(computedNet - proposedHours) > 0.01) {
        throw new ConfirmationEvidenceError(
          "HOURS_TIME_MISMATCH",
          `Die genehmigten Stunden (${proposedHours}) stimmen nicht mit den Zeitangaben überein (Beginn ${startTime}, Ende ${endTime}, Pause ${breakMinutes}m = ${computedNet} Std).`,
          400
        );
      }

      // Compute causal monotonic revision for approved corrections on this assignment
      const latestApprovedBefore = await tx.workHoursCorrectionRequest.findFirst({
        where: {
          assignmentId: request.assignmentId,
          status: "approved",
        },
        orderBy: [
          { revision: "desc" },
          { decidedAt: "desc" },
          { requestedAt: "desc" },
          { id: "desc" },
        ],
        select: { revision: true },
      });
      const nextRevision = (latestApprovedBefore?.revision ?? 0) + 1;

      // Atomic conditional update at database level:
      // Guarantees that only a request currently in "proposed" status transitions to "approved"
      const updateResult = await tx.workHoursCorrectionRequest.updateMany({
        where: {
          id: request.id,
          status: "proposed",
        },
        data: {
          status: "approved",
          revision: nextRevision,
          baseVersion: currentEffective.effectiveVersion,
          proposedStartTime: startTime,
          proposedEndTime: endTime,
          proposedBreakMinutes: breakMinutes,
          decidedById: params.currentUser.id,
          decidedAt: params.decidedAt ?? now,
          decisionNote: params.decisionNote?.trim() || null,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConfirmationEvidenceError(
          "ALREADY_DECIDED",
          "Dieser Korrekturantrag wurde bereits parallel entschieden.",
          409
        );
      }

      return await tx.workHoursCorrectionRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
    });
  } catch (err: unknown) {
    if (err instanceof ConfirmationEvidenceError) throw err;
    const errorCode = (err as { code?: string })?.code;
    const meta = (err as { meta?: { target?: string[] | string } })?.meta;
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (
      errorCode === "P2002" &&
      (errorMessage.includes("work_hours_correction_requests_assignment_base_approved_key") ||
        errorMessage.includes("base_version") ||
        (Array.isArray(meta?.target) && meta.target.includes("base_version")) ||
        (typeof meta?.target === "string" && meta.target.includes("base_version")))
    ) {
      throw new ConfirmationEvidenceError(
        "CONCURRENT_DECISION_CONFLICT",
        "Es wurde bereits parallel eine andere Korrektur für dieselbe Basis-Version genehmigt.",
        409
      );
    }
    throw err;
  }
}

/**
 * Server Operation 3: Explicitly rejects a proposed hours correction request.
 *
 * Invariants:
 * - Requires admin authorization.
 * - Rejects already decided requests (ALREADY_DECIDED).
 * - Atomic DB conditional transition: updateMany with { id, status: "proposed" } and count === 1.
 * - Records decision maker, timestamp, and decision note.
 * - Leaves effective hours at previous baseline without mutating anything else.
 */
export async function rejectHoursCorrectionRequest(
  params: RejectHoursCorrectionParams
) {
  const isAdmin =
    params.currentUser.role === "admin" || params.currentUser.role === "super_admin";
  if (!isAdmin) {
    throw new ConfirmationEvidenceError(
      "FORBIDDEN",
      "Nur Administratoren dürfen Stundenkorrekturen ablehnen.",
      403
    );
  }

  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    const request = await tx.workHoursCorrectionRequest.findUnique({
      where: { id: params.correctionRequestId },
    });

    if (!request) {
      throw new ConfirmationEvidenceError(
        "CORRECTION_REQUEST_NOT_FOUND",
        "Der angegebene Korrekturantrag wurde nicht gefunden.",
        404
      );
    }

    if (request.status === "approved") {
      throw new ConfirmationEvidenceError(
        "ALREADY_DECIDED",
        "Dieser Korrekturantrag wurde bereits genehmigt.",
        409
      );
    }
    if (request.status === "rejected") {
      throw new ConfirmationEvidenceError(
        "ALREADY_DECIDED",
        "Dieser Korrekturantrag wurde bereits abgelehnt.",
        409
      );
    }

    // Atomic conditional update at database level
    const updateResult = await tx.workHoursCorrectionRequest.updateMany({
      where: {
        id: request.id,
        status: "proposed",
      },
      data: {
        status: "rejected",
        decidedById: params.currentUser.id,
        decidedAt: now,
        decisionNote: params.decisionNote?.trim() || "Abgelehnt durch Administrator",
      },
    });

    if (updateResult.count !== 1) {
      throw new ConfirmationEvidenceError(
        "ALREADY_DECIDED",
        "Dieser Korrekturantrag wurde bereits parallel entschieden.",
        409
      );
    }

    return await tx.workHoursCorrectionRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
  });
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

  const allCorrections = await prisma.workHoursCorrectionRequest.findMany({
    where: { assignmentId },
    orderBy: { requestedAt: "desc" },
  });

  const pendingCorrection = allCorrections.find((c) => c.status === "proposed") || null;
  const effectiveInfo = await getAssignmentEffectiveWorkHours(assignmentId, prisma);

  const scheduledHours = netShiftHours(
    assignment.order.startTime,
    assignment.order.endTime,
    assignment.order.breakMinutes
  );

  const sc = assignment.serviceConfirmation;
  const legacyIsArchivedPdf = Boolean(
    sc?.method === "electronic" &&
      Boolean(
        sc?.documentUrl &&
          (sc.documentUrl.includes("/signed/") ||
            sc.documentUrl.includes("signed-confirmations") ||
            sc.documentUrl.endsWith(".pdf"))
      )
  );
  const legacyIsDynamicView = Boolean(
    sc?.method === "electronic" && !legacyIsArchivedPdf
  );

  const legacyBaseline = sc
    ? {
        exists: true,
        method: sc.method as "electronic" | "upload",
        hoursWorked: sc.hoursWorked ? Number(sc.hoursWorked) : null,
        hasArchivedPdf: legacyIsArchivedPdf,
        isDynamicallyGeneratedView: legacyIsDynamicView,
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

    const matchingCorr = allCorrections.find((c) => c.documentId === d.id);
    const correctionStatus = matchingCorr?.status || null;
    const isCorrectionApproved = correctionStatus === "approved";

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
      correctionStatus,
      isCorrectionApproved,
    };
  });

  // Surface the legacy baseline original if a legacy ServiceConfirmation exists
  // AND there is no modern ConfirmationDocument row that already represents the original electronic signature.
  // This ensures the original remains visible EVEN AFTER subsequent manual sheets or corrections are uploaded!
  const hasModernOriginal = docs.some((d) => d.sourceType === "electronic_original");
  if (sc && !hasModernOriginal) {
    const isArchivedPdf = legacyIsArchivedPdf;
    const isPhysicalScan = Boolean(sc.method === "upload" && sc.documentUrl);
    const isDynamicallyGeneratedView = legacyIsDynamicView;

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

  // Strict chronological sorting:
  // Electronic original or legacy baseline ALWAYS first, followed by manual uploads/corrections in chronological order.
  documentViews.sort((a, b) => {
    const aIsOriginal = a.sourceType === "electronic_original";
    const bIsOriginal = b.sourceType === "electronic_original";
    if (aIsOriginal && !bIsOriginal) return -1;
    if (!aIsOriginal && bIsOriginal) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

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
    effectiveWorkHours: effectiveInfo.effectiveHours,
    effectiveStartTime: effectiveInfo.effectiveStartTime,
    effectiveEndTime: effectiveInfo.effectiveEndTime,
    effectiveBreakMinutes: effectiveInfo.effectiveBreakMinutes,
    effectiveSource: effectiveInfo.source,
    effectiveVersion: effectiveInfo.effectiveVersion,
    isCorrected: effectiveInfo.isCorrected,
    approvedCorrection: effectiveInfo.approvedCorrection,
    legacyConfirmation: legacyBaseline,
    legacyBaseline,
    documents: documentViews,
    pendingCorrection: pendingCorrection
      ? {
          id: pendingCorrection.id,
          documentId: pendingCorrection.documentId,
          baseVersion: pendingCorrection.baseVersion || null,
          revision: pendingCorrection.revision ?? 1,
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
          decidedAt: pendingCorrection.decidedAt
            ? pendingCorrection.decidedAt.toISOString()
            : null,
          decidedById: pendingCorrection.decidedById,
          decisionNote: pendingCorrection.decisionNote,
        }
      : null,
    corrections: allCorrections.map((c) => ({
      id: c.id,
      documentId: c.documentId,
      baseVersion: c.baseVersion || null,
      revision: c.revision ?? 1,
      status: c.status,
      previousHoursWorked: c.previousHoursWorked ? Number(c.previousHoursWorked) : null,
      proposedHoursWorked: Number(c.proposedHoursWorked),
      proposedStartTime: c.proposedStartTime,
      proposedEndTime: c.proposedEndTime,
      proposedBreakMinutes: c.proposedBreakMinutes,
      reason: c.reason,
      requestedAt: c.requestedAt.toISOString(),
      requestedById: c.requestedById,
      decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
      decidedById: c.decidedById,
      decisionNote: c.decisionNote,
    })),
  };
}

/**
 * Sanitizes an EvidenceTimeline DTO before returning it to the browser/client,
 * removing internal storage paths and sensitive storage keys from metadata.
 * The client accesses files exclusively through authenticated endpoints like
 * /api/confirmations/[assignmentId]/document?documentId=...
 */
export function sanitizePublicEvidenceTimeline(
  timeline: EvidenceTimeline
): EvidenceTimeline {
  return {
    ...timeline,
    documents: timeline.documents.map((doc) => {
      const sanitizedDoc = { ...doc };
      delete sanitizedDoc.storagePath;

      if (sanitizedDoc.metadata && typeof sanitizedDoc.metadata === "object") {
        const cleanMeta: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(sanitizedDoc.metadata)) {
          const lower = key.toLowerCase();
          if (
            lower.includes("storage") ||
            lower.includes("path") ||
            lower.includes("bucket") ||
            lower.includes("url")
          ) {
            continue;
          }
          cleanMeta[key] = val;
        }
        sanitizedDoc.metadata = Object.keys(cleanMeta).length > 0 ? cleanMeta : null;
      }

      return sanitizedDoc;
    }),
  };
}

export type UploadWorkerMultiShiftParams = {
  workerId: string;
  assignmentIds: string[];
  file: EvidenceFilePayload;
  signerName?: string;
  notes?: string;
  currentUser: {
    id: string;
    role: string;
    clientId?: string | null;
  };
};

export type UploadWorkerMultiShiftResult = {
  success: boolean;
  count: number;
  storagePath: string;
  fileHash: string;
  documents: {
    id: string;
    assignmentId: string;
    sourceType: ConfirmationDocumentSourceType;
    storagePath: string | null;
  }[];
};

/**
 * Phase 3b: Uploads a single physical timesheet document for one or multiple shifts
 * strictly belonging to the specified worker.
 *
 * Guarantees:
 * 1. Admin/super_admin role verification.
 * 2. Atomic validation: rejects entire request if any assignmentId is missing, non-existent,
 *    or belongs to another worker.
 * 3. File validation: max 25 MB, allowed MIME types (PDF, PNG, JPEG, WebP), genuine magic bytes.
 * 4. Single physical file upload with upsert: false.
 * 5. Multi-record linking in a single DB transaction.
 * 6. Preserves existing ServiceConfirmation (hoursWorked, method, signatureData, confirmedAt)
 *    if the shift was already confirmed!
 * 7. Storage cleanup on failure (no orphaned files).
 */
export async function uploadWorkerMultiShiftEvidence(
  params: UploadWorkerMultiShiftParams
): Promise<UploadWorkerMultiShiftResult> {
  const isAdmin =
    params.currentUser.role === "admin" || params.currentUser.role === "super_admin";
  if (!isAdmin) {
    throw new ConfirmationEvidenceError(
      "FORBIDDEN",
      "Nur Administratoren dürfen Stundenzettel für Mitarbeiter hochladen.",
      403
    );
  }

  if (!params.workerId || typeof params.workerId !== "string" || !params.workerId.trim()) {
    throw new ConfirmationEvidenceError("INVALID_WORKER_ID", "Ungültige Mitarbeiter-ID.", 400);
  }
  const worker = await prisma.worker.findUnique({
    where: { id: params.workerId.trim() },
    select: { id: true, fullName: true },
  });
  if (!worker) {
    throw new ConfirmationEvidenceError(
      "WORKER_NOT_FOUND",
      "Der angegebene Mitarbeiter existiert nicht.",
      404
    );
  }

  if (!Array.isArray(params.assignmentIds) || params.assignmentIds.length === 0) {
    throw new ConfirmationEvidenceError(
      "INVALID_ASSIGNMENT_IDS",
      "Mindestens eine Schicht muss ausgewählt werden.",
      400
    );
  }

  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const rawId of params.assignmentIds) {
    if (typeof rawId !== "string") {
      throw new ConfirmationEvidenceError(
        "INVALID_ASSIGNMENT_IDS",
        "Ungültiger Schichtbezeichner: Es werden nur nicht-leere Zeichenketten akzeptiert.",
        400
      );
    }
    const trimmed = rawId.trim();
    if (!trimmed) {
      throw new ConfirmationEvidenceError(
        "INVALID_ASSIGNMENT_IDS",
        "Ungültiger Schichtbezeichner: Leere Schicht-IDs sind nicht zulässig.",
        400
      );
    }
    if (seenIds.has(trimmed)) {
      throw new ConfirmationEvidenceError(
        "INVALID_ASSIGNMENT_IDS",
        `Doppelte Schicht-ID '${trimmed}' in der Auswahlliste.`,
        400
      );
    }
    seenIds.add(trimmed);
    normalizedIds.push(trimmed);
  }

  const uniqueAssignmentIds = normalizedIds;

  const assignments = await prisma.assignment.findMany({
    where: { id: { in: uniqueAssignmentIds } },
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
              facilityName: true,
            },
          },
        },
      },
      worker: {
        select: {
          id: true,
          fullName: true,
        },
      },
      serviceConfirmation: true,
    },
  });

  if (assignments.length !== uniqueAssignmentIds.length) {
    throw new ConfirmationEvidenceError(
      "ASSIGNMENT_NOT_FOUND",
      "Eine oder mehrere der angegebenen Schichten wurden nicht gefunden.",
      404
    );
  }

  const mismatched = assignments.find((a) => a.workerId !== worker.id);
  if (mismatched) {
    throw new ConfirmationEvidenceError(
      "WORKER_MISMATCH",
      "Eine oder mehrere Schichten gehören nicht zum angegebenen Mitarbeiter.",
      403
    );
  }

  validateEvidenceFile(params.file);
  const fileHash = computeFileSha256(params.file.buffer);
  const safeName = sanitizeFileName(params.file.fileName);
  const cleanMime = params.file.mimeType.toLowerCase().split(";")[0].trim();

  const existingDocs = await prisma.confirmationDocument.findMany({
    where: {
      assignmentId: { in: uniqueAssignmentIds },
      fileHash,
    },
    select: { assignmentId: true },
  });
  if (existingDocs.length > 0) {
    throw new ConfirmationEvidenceError(
      "DUPLICATE_DOCUMENT",
      "Dieses Dokument wurde für eine oder mehrere der ausgewählten Schichten bereits hochgeladen.",
      409
    );
  }

  const randomSlug = crypto.randomBytes(6).toString("hex");
  const storagePath = `signed-confirmations/worker-${worker.id}/${Date.now()}-${randomSlug}-${safeName}`;

  const supabase = createSupabaseAdminClient();
  const { error: uploadError } = await supabase.storage
    .from("confirmations")
    .upload(storagePath, params.file.buffer, {
      contentType: cleanMime,
      upsert: false,
    });

  if (uploadError) {
    throw new ConfirmationEvidenceError(
      "STORAGE_UPLOAD_FAILED",
      `Fehler beim Hochladen der Datei ins Speichersystem: ${uploadError.message}`,
      500
    );
  }

  const uploadedToStorage = true;
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const createdDocs = [];

      for (const a of assignments) {
        // Create ConfirmationDocument record without mutating ServiceConfirmation
        const doc = await tx.confirmationDocument.create({
          data: {
            assignmentId: a.id,
            sourceType: a.serviceConfirmation ? "manual_correction" : "manual_upload",
            storagePath,
            fileHash,
            fileName: safeName,
            mimeType: cleanMime,
            fileSizeBytes: params.file.sizeBytes,
            signerName: params.signerName || null,
            uploadedById: params.currentUser.id,
            uploaderRole: params.currentUser.role,
            metadata: {
              notes: params.notes || null,
              multiShiftBatchCount: uniqueAssignmentIds.length,
              workerId: worker.id,
              clientFacilityName: a.order.client.facilityName,
            },
            createdAt: now,
          },
        });
        createdDocs.push(doc);
      }

      return {
        success: true,
        count: createdDocs.length,
        storagePath,
        fileHash,
        documents: createdDocs.map((d) => ({
          id: d.id,
          assignmentId: d.assignmentId,
          sourceType: d.sourceType,
          storagePath: d.storagePath,
        })),
      };
    });
  } catch (dbErr) {
    if (uploadedToStorage) {
      try {
        await supabase.storage.from("confirmations").remove([storagePath]);
      } catch (cleanupErr) {
        console.error("Failed to clean up storage file after DB failure:", cleanupErr);
      }
    }
    const errorMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
    if (errorMessage.includes("DUPLICATE_DOCUMENT") || errorMessage.includes("P2002")) {
      throw new ConfirmationEvidenceError(
        "DUPLICATE_DOCUMENT",
        "Dieses Dokument wurde für eine oder mehrere der ausgewählten Schichten bereits hochgeladen.",
        409
      );
    }
    throw dbErr;
  }
}
