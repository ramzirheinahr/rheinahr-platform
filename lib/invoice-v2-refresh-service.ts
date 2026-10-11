/**
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization (Phase 6)
 *
 * V2 Single-Invoice Explicit Refresh & Revision Preservation Service
 *
 * Core Guarantees:
 * 1. Single Legacy Invoice Target:
 *    Only updates a single explicitly chosen invoice. Never touches unselected invoices.
 * 2. Immutable Revision History:
 *    Always archives the complete previous financial state and snapshot in `InvoiceRevision`
 *    before updating. Never deletes or overwrites previous revisions.
 * 3. Two-Step Preview & Confirmation with HMAC-SHA256 Token:
 *    Requires admin-authorized preview producing an HMAC-signed, 15-minute expiring token
 *    strictly bound to the administrator, invoice database state, and draft hash.
 * 4. In-Transaction Freshness & Concurrency Protocol:
 *    Locks rows on physical tables ("invoices", "assignments") with deterministic ordering.
 *    Re-reads all sources inside the transaction and aborts on any draft or state mutation.
 * 5. Single V2 Engine Parity:
 *    Derives DB amounts, snapshotData, and PDF inputs from a single display-anchored V2 calculation.
 * 6. Protection for Sent & Paid Invoices:
 *    Strictly prevents updating paid invoices. Mandates explicit confirmation for invoices
 *    already sent to the client (emailSent) without triggering unapproved email dispatch.
 * 7. Reliable Origin Standard:
 *    Rejects updating historical invoices lacking a reliable stored PDF file or frozen line items.
 * 8. Top-Level Frozen Client Attributes:
 *    All client identity attributes (facilityName, address, billingInfo, etc.) are frozen at the
 *    snapshot root level so subsequent live client edits never alter generated PDFs.
 * 9. Successive Revisions Support:
 *    Safely supports sequential monotonic revisions (Rev 1 -> Rev 2 -> Rev 3) preserving full provenance.
 * 10. Zero Fallback:
 *    When FEATURE_INVOICE_V2_REFRESH=false, operations fail explicitly without silent fallback.
 */

import fs from "fs";
import path from "path";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type {
  PriceVersionResolver,
  FacilityPolicyResolver,
  EffectiveHoursResolver,
  V2InvoicePdfItem,
  V2DraftDependencies,
} from "./invoice-v2-draft-service";
import { isV2CalculationVersion } from "./invoice-calculation-version";
import { formatCentsGerman } from "./invoice-exact-engine";
import { computeV2DraftHash } from "./invoice-v2-issuance-service";
import { buildInvoicePdfData } from "./invoice-pdf-builder";
import { generateInvoicePdf } from "@/lib/pdf/invoice";

// ============================================================================
// Error Types
// ============================================================================

export class InvoiceRefreshError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "InvoiceRefreshError";
  }
}

export class InvoiceNotFoundError extends InvoiceRefreshError {
  constructor(invoiceId: string) {
    super("INVOICE_NOT_FOUND", `Rechnung "${invoiceId}" wurde nicht gefunden.`);
  }
}

export class InvoiceCancelledError extends InvoiceRefreshError {
  constructor(invoiceId: string) {
    super(
      "INVOICE_CANCELLED",
      `Stornierte Rechnung "${invoiceId}" kann nicht aktualisiert werden.`
    );
  }
}

export class InvoiceAlreadyPaidError extends InvoiceRefreshError {
  constructor(invoiceId: string) {
    super(
      "INVOICE_ALREADY_PAID",
      `Bezahlte Rechnung "${invoiceId}" kann nicht aktualisiert werden. Für bezahlte Rechnungen ist eine Gutschrift/Stornierung erforderlich.`
    );
  }
}

export class SentInvoiceConfirmationRequiredError extends InvoiceRefreshError {
  constructor(message = "Diese Rechnung wurde bereits versendet. Eine Aktualisierung erfordert eine ausdrückliche Bestätigung (confirmSentInvoiceUpdate: true).") {
    super("SENT_INVOICE_REQUIRES_EXPLICIT_CONFIRMATION", message);
  }
}

export class SentInvoiceRefreshNotPermittedError extends InvoiceRefreshError {
  constructor(invoiceNumber: string) {
    super(
      "SENT_INVOICE_REFRESH_NOT_PERMITTED",
      `Rechnung "${invoiceNumber}" wurde bereits an den Kunden versandt und kann nicht über die Einzelaktualisierung überschrieben werden (Fail-Closed-Schutz für versandte Rechnungen). Eine Korrektur erfordert ein separates Rechnungsberichtigungs- oder Stornierungsverfahren.`
    );
  }
}

export class FreshV2InvoiceImmutableError extends InvoiceRefreshError {
  constructor(invoiceNumber: string) {
    super(
      "FRESH_V2_INVOICE_IMMUTABLE",
      `Rechnung "${invoiceNumber}" wurde ursprünglich unter V2 ausgestellt und ist unveränderlich eingefroren. Eine Aktualisierung über diesen Altrechnungs-Revisionspfad ist ausgeschlossen.`
    );
  }
}

export class RevisionChainCorruptedError extends InvoiceRefreshError {
  constructor(message: string) {
    super("REVISION_CHAIN_CORRUPTED", message);
  }
}

export class MissingRefreshSecretError extends InvoiceRefreshError {
  constructor() {
    super(
      "MISSING_REFRESH_SECRET",
      "Kein sicheres serverseitiges Geheimnis für V2-Vorschau-Tokens konfiguriert (INVOICE_REFRESH_SECRET oder NEXTAUTH_SECRET erforderlich)."
    );
  }
}

export class InsufficientSecretStrengthError extends InvoiceRefreshError {
  constructor() {
    super(
      "INSUFFICIENT_SECRET_STRENGTH",
      "Das serverseitige Signaturgeheimnis ist unzureichend (mindestens 32 Zeichen erforderlich)."
    );
  }
}

export class UnreliableHistoricalOriginError extends InvoiceRefreshError {
  constructor(invoiceId: string, message?: string) {
    super(
      "UNRELIABLE_HISTORICAL_DOCUMENT",
      message ||
        `Historische Rechnung "${invoiceId}" verfügt weder über eine verifizierte PDF-Datei noch über einen vollständigen eingefrorenen Snapshot. Eine Aktualisierung wird abgelehnt, um den Verlust der Originalfassung zu verhindern.`
    );
  }
}

export class AlreadyV2InvoiceError extends InvoiceRefreshError {
  constructor(invoiceId: string) {
    super(
      "ALREADY_V2_FROZEN",
      `Rechnung "${invoiceId}" ist bereits eine unveränderliche V2-Rechnung und kann nicht ohne Revisionsfortschreibung aktualisiert werden.`
    );
  }
}

export class NoAssignmentsLinkedError extends InvoiceRefreshError {
  constructor(invoiceId: string) {
    super(
      "NO_ASSIGNMENTS_LINKED",
      `Rechnung "${invoiceId}" hat keine zugeordneten Schichten.`
    );
  }
}

export class StalePreviewError extends InvoiceRefreshError {
  constructor(message = "Die Berechnungsgrundlage der Rechnung hat sich seit der Vorschau geändert. Bitte Vorschau aktualisieren.") {
    super("STALE_PREVIEW_DETECTED", message);
  }
}

export class ConcurrentModificationError extends InvoiceRefreshError {
  constructor(message = "Gleichzeitiger Änderungskonflikt bei der Rechnungsaktualisierung.") {
    super("CONCURRENT_MODIFICATION", message);
  }
}

export class FeatureDisabledError extends InvoiceRefreshError {
  constructor() {
    super(
      "FEATURE_DISABLED",
      "Die V2-Rechnungsaktualisierung ist serverseitig deaktiviert (FEATURE_INVOICE_V2_REFRESH=false). Ein automatischer Rückfall auf die alte fehlerhafte Neuberechnung ist ausgeschlossen."
    );
  }
}

// ============================================================================
// Feature Flag & Cryptographic Preview Token
// ============================================================================

export function isV2RefreshEnabled(): boolean {
  return process.env.FEATURE_INVOICE_V2_REFRESH === "true";
}

export function getRefreshSecret(explicitSecret?: string): string {
  const secret =
    explicitSecret ||
    process.env.INVOICE_REFRESH_SECRET ||
    process.env.NEXTAUTH_SECRET;

  if (!secret || typeof secret !== "string" || secret.trim().length === 0) {
    throw new MissingRefreshSecretError();
  }

  if (secret.trim().length < 32) {
    throw new InsufficientSecretStrengthError();
  }

  return secret.trim();
}

export type RefreshPreviewTokenPayload = {
  v: 1;
  invoiceId: string;
  adminId: string;
  issuedAt: number;
  expiresAt: number;
  previousGrossCents: number;
  newGrossCents: number;
  invoiceStateHash: string;
  draftHash: string;
  baseRevisionNumber: number;
  assignmentIdsHash: string;
};

export function computeInvoiceStateHash(invoice: {
  id: string;
  status: string;
  grossAmount: number | Prisma.Decimal;
  updatedAt?: Date | string | null;
  snapshotData?: unknown;
}): string {
  const updatedAtStr =
    invoice.updatedAt instanceof Date
      ? invoice.updatedAt.toISOString()
      : typeof invoice.updatedAt === "string"
      ? invoice.updatedAt
      : "";
  const grossNum = Number(invoice.grossAmount);
  const snapStr = invoice.snapshotData ? JSON.stringify(invoice.snapshotData) : "";
  const raw = `${invoice.id}::${invoice.status}::${grossNum.toFixed(2)}::${updatedAtStr}::${snapStr}`;
  return createHash("sha256").update(raw).digest("hex");
}

export function computeRefreshPreviewToken(params: {
  invoiceId: string;
  adminId: string;
  previousGrossCents: number;
  newGrossCents: number;
  invoiceStateHash: string;
  draftHash: string;
  baseRevisionNumber: number;
  assignmentIds: string[];
  issuedAt?: number;
  ttlMs?: number;
  secret?: string;
}): string {
  const secret = getRefreshSecret(params.secret);
  const issuedAt = params.issuedAt ?? Date.now();
  const ttlMs = params.ttlMs ?? 15 * 60 * 1000; // 15 minutes TTL
  const expiresAt = issuedAt + ttlMs;

  const sortedAssignmentIds = [...params.assignmentIds].sort();
  const assignmentIdsHash = createHash("sha256").update(sortedAssignmentIds.join(",")).digest("hex");

  const payload: RefreshPreviewTokenPayload = {
    v: 1,
    invoiceId: params.invoiceId,
    adminId: params.adminId,
    issuedAt,
    expiresAt,
    previousGrossCents: params.previousGrossCents,
    newGrossCents: params.newGrossCents,
    invoiceStateHash: params.invoiceStateHash,
    draftHash: params.draftHash,
    baseRevisionNumber: params.baseRevisionNumber,
    assignmentIdsHash,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("hex");

  return `v1.${encodedPayload}.${signature}`;
}

export function verifyRefreshPreviewToken(
  token: string,
  expected: {
    invoiceId: string;
    adminId: string;
    previousGrossCents: number;
    newGrossCents: number;
    invoiceStateHash: string;
    draftHash: string;
    baseRevisionNumber: number;
    assignmentIds: string[];
    currentTime?: number;
    secret?: string;
  }
): { valid: true; payload: RefreshPreviewTokenPayload } | { valid: false; code: string; message: string } {
  if (typeof token !== "string" || !token.startsWith("v1.")) {
    return {
      valid: false,
      code: "INVALID_TOKEN_FORMAT",
      message: "Ungültiges Vorschau-Token-Format.",
    };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    return {
      valid: false,
      code: "INVALID_TOKEN_FORMAT",
      message: "Ungültiges Vorschau-Token-Format.",
    };
  }

  const [, encodedPayload, signature] = parts;

  let secret: string;
  try {
    secret = getRefreshSecret(expected.secret);
  } catch (secErr) {
    if (secErr instanceof InvoiceRefreshError) {
      return {
        valid: false,
        code: secErr.code,
        message: secErr.message,
      };
    }
    return {
      valid: false,
      code: "MISSING_REFRESH_SECRET",
      message: "Kein gültiges Signaturgeheimnis konfiguriert.",
    };
  }

  const expectedSignature = createHmac("sha256", secret).update(encodedPayload).digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expSigBuf = Buffer.from(expectedSignature, "hex");

  if (sigBuf.length !== expSigBuf.length || !timingSafeEqual(sigBuf, expSigBuf)) {
    return {
      valid: false,
      code: "TOKEN_SIGNATURE_INVALID",
      message:
        "Die kryptografische Signatur des Vorschau-Tokens ist ungültig (Manipulationsversuch oder geänderter Serverschlüssel).",
    };
  }

  let payload: RefreshPreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return {
      valid: false,
      code: "TOKEN_PAYLOAD_CORRUPT",
      message: "Das Vorschau-Token enthält beschädigte Daten.",
    };
  }

  const now = expected.currentTime ?? Date.now();
  const maxClockSkewMs = 5000; // 5 seconds allowable clock skew

  if (payload.issuedAt > now + maxClockSkewMs) {
    return {
      valid: false,
      code: "TOKEN_ISSUED_IN_FUTURE",
      message: "Das Vorschau-Token weist einen ungültigen Ausstellungszeitpunkt in der Zukunft auf (Manipulationsversuch).",
    };
  }

  if (payload.expiresAt <= payload.issuedAt) {
    return {
      valid: false,
      code: "INVALID_TOKEN_TIMING",
      message: "Das Vorschau-Token hat eine ungültige Gültigkeitsdauer.",
    };
  }

  if (now > payload.expiresAt) {
    return {
      valid: false,
      code: "TOKEN_EXPIRED",
      message: "Das Vorschau-Token ist abgelaufen (Gültigkeit: 15 Minuten). Vorschau muss neu generiert werden.",
    };
  }

  if (payload.adminId !== expected.adminId) {
    return {
      valid: false,
      code: "ADMIN_MISMATCH",
      message: `Das Vorschau-Token wurde für Administrator "${payload.adminId}" ausgestellt, wird aber von "${expected.adminId}" bestätigt. Ein Administratorwechsel zwischen Vorschau und Bestätigung ist unzulässig.`,
    };
  }

  if (payload.invoiceId !== expected.invoiceId) {
    return {
      valid: false,
      code: "INVOICE_MISMATCH",
      message: `Das Vorschau-Token gehört zu Rechnung "${payload.invoiceId}", nicht zu "${expected.invoiceId}".`,
    };
  }

  if (payload.baseRevisionNumber !== expected.baseRevisionNumber) {
    return {
      valid: false,
      code: "REVISION_MISMATCH",
      message: `Die Revisionsnummer der Rechnung hat sich geändert (erwartet: ${expected.baseRevisionNumber}, im Token: ${payload.baseRevisionNumber}).`,
    };
  }

  if (payload.previousGrossCents !== expected.previousGrossCents) {
    return {
      valid: false,
      code: "HISTORICAL_AMOUNT_MISMATCH",
      message: "Der historische Rechnungsbetrag stimmt nicht mit der Vorschau überein.",
    };
  }

  if (payload.newGrossCents !== expected.newGrossCents) {
    return {
      valid: false,
      code: "PROPOSED_AMOUNT_MISMATCH",
      message: "Der neu berechnete Rechnungsbetrag stimmt nicht mit der Vorschau überein.",
    };
  }

  if (payload.invoiceStateHash !== expected.invoiceStateHash) {
    return {
      valid: false,
      code: "INVOICE_STATE_CHANGED",
      message: "Der Zustand der Rechnung in der Datenbank hat sich seit der Vorschau geändert.",
    };
  }

  if (payload.draftHash !== expected.draftHash) {
    return {
      valid: false,
      code: "DRAFT_MUTATION_DETECTED",
      message: "Die Berechnungsgrundlage (Schichten, Zeiten oder Sätze) hat sich seit der Vorschau geändert.",
    };
  }

  const sortedAssignmentIds = [...expected.assignmentIds].sort();
  const expectedAssignmentIdsHash = createHash("sha256").update(sortedAssignmentIds.join(",")).digest("hex");
  if (payload.assignmentIdsHash !== expectedAssignmentIdsHash) {
    return {
      valid: false,
      code: "ASSIGNMENT_IDS_CHANGED",
      message: "Die zugeordneten Schichten haben sich seit der Vorschau geändert.",
    };
  }

  return { valid: true, payload };
}

export function maskTokenForAudit(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function isInvoiceSent(invoice: {
  status?: string;
  snapshotData?: unknown;
}): boolean {
  if (invoice.status === "sent") return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  if (!snap || typeof snap !== "object") return false;
  return Boolean(snap.emailSent || snap.sentAt || snap.emailSentAt || snap.sentTo);
}

export type FileVerificationResult = {
  exists: boolean;
  byteLength?: number;
  sha256?: string;
  buffer?: Buffer;
  realPath?: string;
  reason?: string;
};

export type FileVerifier = (
  pathOrUrl: string
) => Promise<FileVerificationResult> | FileVerificationResult;

function isUnderPublicRoot(p: string): boolean {
  const norm = path.resolve(p);
  const pub = path.resolve(process.cwd(), "public");
  if (norm === pub || norm.startsWith(pub + path.sep)) {
    return true;
  }
  try {
    const realPub = fs.existsSync(pub) ? fs.realpathSync(pub) : pub;
    if (fs.existsSync(norm)) {
      const realNorm = fs.realpathSync(norm);
      if (realNorm === realPub || realNorm.startsWith(realPub + path.sep)) {
        return true;
      }
    } else {
      let curr = norm;
      while (curr !== path.dirname(curr)) {
        curr = path.dirname(curr);
        if (fs.existsSync(curr)) {
          const realCurr = fs.realpathSync(curr);
          if (realCurr === realPub || realCurr.startsWith(realPub + path.sep)) {
            return true;
          }
          break;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Returns canonical list of directories permitted to store and serve invoice PDFs.
 * Protects against arbitrary file path traversal, unauthorized file disclosure, and symlink attacks.
 * Strictly excludes web-exposed public directories (e.g. public/invoices).
 */
export function getAllowedInvoiceStorageRoots(customRoots?: string[]): string[] {
  const roots: string[] = [];
  if (customRoots && customRoots.length > 0) {
    for (const r of customRoots) {
      if (!isUnderPublicRoot(r)) {
        roots.push(path.resolve(r));
      }
    }
  }
  if (process.env.INVOICE_STORAGE_ROOT) {
    const root = path.resolve(process.env.INVOICE_STORAGE_ROOT);
    if (!isUnderPublicRoot(root)) {
      roots.push(root);
    }
  }
  if (process.env.INVOICE_ARCHIVE_DIR) {
    const archiveRoot = path.resolve(process.env.INVOICE_ARCHIVE_DIR);
    if (!isUnderPublicRoot(archiveRoot)) {
      roots.push(archiveRoot);
    }
  }
  roots.push(
    path.resolve(process.cwd(), "storage/invoices"),
    path.resolve(process.cwd(), "storage/archived-invoices")
  );
  return roots;
}

export function getArchivedInvoicesDirectory(): string {
  if (process.env.INVOICE_ARCHIVE_DIR) {
    const configured = path.resolve(process.env.INVOICE_ARCHIVE_DIR);
    if (isUnderPublicRoot(configured)) {
      throw new InvoiceRefreshError(
        "INSECURE_STORAGE_CONFIGURATION",
        `[INSECURE_STORAGE_CONFIGURATION] Das konfigurierte Archivverzeichnis "${configured}" liegt innerhalb des öffentlichen Verzeichnisses (public/) und ist unzulässig.`
      );
    }
    return configured;
  }
  return path.resolve(process.cwd(), "storage/archived-invoices");
}

export type ArchivedPdfResult = {
  archivedPath: string;
  sourceOriginalPath: string;
  sha256: string;
  byteLength: number;
};

/**
 * Copies the verified original historical PDF to a dedicated, permanent private archive storage
 * before performing the invoice update. Verifies read-back integrity immediately.
 * Throws ORIGINAL_PDF_ARCHIVAL_FAILED on any error, causing complete transaction rollback.
 */
export async function persistArchivedOriginalPdf(
  sourcePath: string,
  invoiceId: string,
  expectedSha256?: string,
  verifier: FileVerifier = defaultFileVerifier
): Promise<ArchivedPdfResult> {
  const sourceCheck = await verifier(sourcePath);
  if (!sourceCheck.exists || !sourceCheck.buffer || !sourceCheck.sha256 || !sourceCheck.byteLength) {
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Quelldatei "${sourcePath}" konnte nicht verifiziert werden (${sourceCheck.reason || "Datei ungültig"}).`
    );
  }

  if (expectedSha256 && sourceCheck.sha256 !== expectedSha256) {
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Checksum der Quelldatei stimmt nicht mit der erwarteten Prüfsumme überein.`
    );
  }

  const archiveDir = getArchivedInvoicesDirectory();
  if (!fs.existsSync(archiveDir)) {
    try {
      fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new InvoiceRefreshError(
        "ORIGINAL_PDF_ARCHIVAL_FAILED",
        `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Archivverzeichnis konnte nicht erstellt werden (${err instanceof Error ? err.message : String(err)}).`
      );
    }
  }

  // Canonical realpath check of the archive directory BEFORE creating any file (temp or target)
  const canonicalArchiveDir = fs.realpathSync(archiveDir);
  if (isUnderPublicRoot(canonicalArchiveDir)) {
    throw new InvoiceRefreshError(
      "INSECURE_STORAGE_CONFIGURATION",
      `[INSECURE_STORAGE_CONFIGURATION] Das aufgelöste Archivverzeichnis ("${canonicalArchiveDir}") liegt innerhalb von public/ und ist unzulässig.`
    );
  }

  const safeInvoiceId = invoiceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const targetFilename = `invoice-${safeInvoiceId}-rev0-${sourceCheck.sha256.slice(0, 16)}.pdf`;
  const targetPath = path.resolve(archiveDir, targetFilename);

  // Exclusive creation check: never overwrite an already existing archive document
  if (fs.existsSync(targetPath)) {
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivdatei "${targetFilename}" existiert bereits im Archiv und darf nicht überschrieben werden.`
    );
  }

  // Atomic write via temporary file + atomic linkSync (hard link) to prevent partial writes and overwrites
  const tempFilename = `.${targetFilename}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  const tempPath = path.resolve(archiveDir, tempFilename);

  try {
    fs.writeFileSync(tempPath, sourceCheck.buffer, { mode: 0o600, flag: "wx" });
  } catch (err) {
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Temporäre Zieldatei konnte nicht geschrieben werden (${err instanceof Error ? err.message : String(err)}).`
    );
  }

  try {
    // Atomic linkSync: if targetPath already exists (e.g. race condition / concurrent worker), linkSync throws EEXIST and NEVER overwrites targetPath!
    fs.linkSync(tempPath, targetPath);
    // Remove the temporary file after atomic link
    fs.unlinkSync(tempPath);
  } catch (err: unknown) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr && (nodeErr.code === "EEXIST" || nodeErr.message?.includes("EEXIST"))) {
      throw new InvoiceRefreshError(
        "ORIGINAL_PDF_ARCHIVAL_FAILED",
        `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivdatei "${targetFilename}" existiert bereits im Archiv und darf nicht überschrieben werden.`
      );
    }
    if (err instanceof InvoiceRefreshError) throw err;
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Atomare Verknüpfung in den Zielpfad fehlgeschlagen (${err instanceof Error ? err.message : String(err)}).`
    );
  }

  // Strict read-back verification after write
  const verifyArchived = defaultFileVerifier(targetPath, {
    allowedRoots: [archiveDir, ...getAllowedInvoiceStorageRoots()],
  });

  if (
    !verifyArchived.exists ||
    verifyArchived.sha256 !== sourceCheck.sha256 ||
    verifyArchived.byteLength !== sourceCheck.byteLength
  ) {
    try {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    } catch {
      // ignore rollback deletion error
    }
    throw new InvoiceRefreshError(
      "ORIGINAL_PDF_ARCHIVAL_FAILED",
      `[ORIGINAL_PDF_ARCHIVAL_FAILED] Archivierung des Original-PDFs fehlgeschlagen: Die archivierte Kopie konnte nach dem Schreiben nicht verifiziert werden.`
    );
  }

  return {
    archivedPath: targetPath,
    sourceOriginalPath: sourceCheck.realPath || sourcePath,
    sha256: sourceCheck.sha256,
    byteLength: sourceCheck.byteLength,
  };
}

/**
 * Validates whether a file is a genuine, safely stored invoice PDF:
 * 1. Resolves path safely, strips file://, and rejects arbitrary remote URLs without local storage.
 * 2. Follows symlinks via fs.realpathSync and verifies that target is inside allowed invoice storage roots.
 * 3. Enforces size bounds: minimum 100 bytes (smallest valid PDF header+trailer), maximum 25 MB.
 * 4. Enforces PDF magic bytes check (%PDF-).
 * 5. Calculates deterministic SHA-256 and byte length.
 */
export const defaultFileVerifier = (
  pathOrUrl: string,
  options?: { allowedRoots?: string[] }
): FileVerificationResult => {
  try {
    if (!pathOrUrl || typeof pathOrUrl !== "string" || !pathOrUrl.trim()) {
      return { exists: false, reason: "Dateipfad ist leer." };
    }
    const trimmed = pathOrUrl.trim();
    let localPath = trimmed;
    if (localPath.startsWith("file://")) {
      try {
        localPath = new URL(localPath).pathname;
      } catch {
        localPath = localPath.replace(/^file:\/\//, "");
      }
    }

    // Remote URLs without a local mapped file cannot be verified on disk
    if (/^https?:\/\//i.test(localPath)) {
      return {
        exists: false,
        reason: `Entfernte URL "${trimmed}" kann ohne verifizierten lokalen Speicher nicht als vertrauenswürdiges Originaldokument bestätigt werden.`,
      };
    }

    // Candidate paths to check
    const candidates: string[] = [];
    if (path.isAbsolute(localPath)) {
      candidates.push(localPath);
    } else {
      candidates.push(
        path.resolve(process.cwd(), "storage/invoices", localPath.replace(/^\/+/, "")),
        path.resolve(process.cwd(), "storage/archived-invoices", localPath.replace(/^\/+/, "")),
        path.resolve(process.cwd(), localPath)
      );
    }

    let existingCandidate: string | null = null;
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        existingCandidate = cand;
        break;
      }
    }

    if (!existingCandidate) {
      return {
        exists: false,
        reason: `Datei "${trimmed}" existiert nicht im Dateisystem oder ist nicht erreichbar.`,
      };
    }

    // Security Check: Symlink resolution & storage boundary containment
    let realPath: string;
    try {
      realPath = fs.realpathSync(existingCandidate);
    } catch {
      return {
        exists: false,
        reason: `Datei "${trimmed}" konnte nicht im Dateisystem aufgelöst werden.`,
      };
    }

    const allowedRoots = options?.allowedRoots || getAllowedInvoiceStorageRoots();
    const isWithinAllowedRoot = allowedRoots.some((root) => {
      const normalizedRoot = path.normalize(root);
      return realPath === normalizedRoot || realPath.startsWith(normalizedRoot + path.sep);
    });

    if (!isWithinAllowedRoot) {
      return {
        exists: false,
        reason: `Pfad "${trimmed}" liegt außerhalb des zulässigen Rechnungs-Speicherbereichs.`,
      };
    }

    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      return { exists: false, reason: `Pfad "${trimmed}" ist keine reguläre Datei.` };
    }

    // PDF Size bounds (100 Bytes to 25 MB)
    if (stat.size < 100) {
      return { exists: false, reason: "Datei ist zu klein für ein gültiges PDF-Dokument (unter 100 Bytes)." };
    }
    if (stat.size > 25 * 1024 * 1024) {
      return { exists: false, reason: "Datei überschreitet die maximale zulässige Dateigröße von 25 MB." };
    }

    // PDF Magic Bytes Check (%PDF-)
    const fd = fs.openSync(realPath, "r");
    const headerBuf = Buffer.alloc(5);
    try {
      fs.readSync(fd, headerBuf, 0, 5, 0);
    } finally {
      fs.closeSync(fd);
    }

    if (headerBuf.toString("utf-8") !== "%PDF-") {
      return {
        exists: false,
        reason: "Datei ist kein valides PDF-Dokument (ungültige PDF-Magic-Bytes; Header '%PDF-' fehlt).",
      };
    }

    const fullBuf = fs.readFileSync(realPath);
    const sha256 = createHash("sha256").update(fullBuf).digest("hex");

    return {
      exists: true,
      byteLength: stat.size,
      sha256,
      buffer: fullBuf,
      realPath,
    };
  } catch (err) {
    return {
      exists: false,
      reason: `Dateiprüfungsfehler: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

/**
 * Safely parses any currency amount (German formatted string, decimal string, or number) into integer cents.
 */
export function parseCurrencyAmountToCents(val: unknown): number | null {
  if (typeof val === "number" && !isNaN(val)) {
    return Math.round(val * 100);
  }
  if (typeof val === "string") {
    const cleaned = val.replace(/\s*€\s*$/, "").trim();
    if (!cleaned) return null;
    // German format: 1.234,56 or 1234,56
    if (/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(cleaned) || /^-?\d+,\d{2}$/.test(cleaned)) {
      const euroStr = cleaned.split(",")[0].replace(/\./g, "");
      const centStr = cleaned.split(",")[1];
      const sign = cleaned.startsWith("-") ? -1 : 1;
      return sign * (Math.abs(parseInt(euroStr, 10)) * 100 + parseInt(centStr, 10));
    }
    // Decimal format: 1234.56
    if (/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
      return Math.round(parseFloat(cleaned) * 100);
    }
  }
  return null;
}

/**
 * Validates that a frozen snapshot is 100% complete, mathematically consistent,
 * and guaranteed to produce a reproducible PDF without relying on live DB entities:
 * 1. Every line item must have description, valid positive hours/quantity, and valid positive amount.
 * 2. Sum of line item amounts must match snapshot subtotal (tolerance <= 2 cents).
 * 3. Sum of line item amounts must match database netAmount if provided (tolerance <= 5 cents).
 * 4. Mandates facilityName, address, and invoice date.
 * 5. Runs a pre-flight simulation with buildInvoicePdfData to verify renderer viability.
 */
export type FrozenSnapshotVerificationResult = {
  complete: boolean;
  reason?: string;
  sha256?: string;
  hasKnownRoundingDiscrepancy?: boolean;
  knownRoundingDiscrepancyCents?: number;
  pdfByteLength?: number;
};

export async function isCompleteFrozenSnapshot(
  snap: unknown,
  invoiceContext?: {
    netAmount?: number;
    vatAmount?: number;
    grossAmount?: number;
    date?: Date | string;
    invoiceNumber?: string;
  }
): Promise<FrozenSnapshotVerificationResult> {
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
    return { complete: false, reason: "Snapshot-Daten fehlen oder sind kein gültiges JSON-Objekt." };
  }
  const s = snap as Record<string, unknown>;

  // Check items or pdfItems
  const items =
    Array.isArray(s.items) && s.items.length > 0
      ? s.items
      : Array.isArray(s.pdfItems) && s.pdfItems.length > 0
      ? s.pdfItems
      : null;

  if (!items || items.length === 0) {
    return {
      complete: false,
      reason: "Snapshot enthält keine eingefrorenen Rechnungsposten (items/pdfItems ist leer oder nicht vorhanden).",
    };
  }

  let calculatedItemsNetCents = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown>;
    if (!it || typeof it !== "object") {
      return { complete: false, reason: `Rechnungsposten #${i + 1} im Snapshot ist kein gültiges Objekt.` };
    }
    const desc = typeof it.description === "string" ? it.description.trim() : "";
    if (!desc) {
      return { complete: false, reason: `Rechnungsposten #${i + 1} hat keine Bezeichnung (description fehlt).` };
    }

    const hasHours =
      (typeof it.hours === "number" && !isNaN(it.hours) && it.hours > 0) ||
      (typeof it.hours === "string" && it.hours.trim() !== "" && (parseCurrencyAmountToCents(it.hours) ?? 0) > 0) ||
      (typeof it.hoursDisplay === "string" && it.hoursDisplay.trim() !== "") ||
      (typeof it.hoursDecimal === "string" && it.hoursDecimal.trim() !== "" && parseFloat(it.hoursDecimal) > 0) ||
      (typeof it.displayHourHundredths === "number" && !isNaN(it.displayHourHundredths) && it.displayHourHundredths > 0) ||
      (typeof it.rawMinutes === "number" && !isNaN(it.rawMinutes) && it.rawMinutes > 0) ||
      (typeof it.quantity === "number" && !isNaN(it.quantity) && it.quantity > 0) ||
      (typeof it.count === "number" && !isNaN(it.count) && it.count > 0);

    let itemAmountCents: number | null = null;
    if (typeof it.amountCents === "number" && !isNaN(it.amountCents)) {
      itemAmountCents = it.amountCents;
    } else {
      const rawAmount = it.amount ?? it.total ?? it.lineTotal;
      itemAmountCents = parseCurrencyAmountToCents(rawAmount);
    }

    if (!hasHours || itemAmountCents === null || itemAmountCents <= 0) {
      return { complete: false, reason: `Rechnungsposten #${i + 1} ist unvollständig (Stunden oder Betrag fehlen oder sind ungültig).` };
    }

    calculatedItemsNetCents += itemAmountCents;
  }

  // Client Facility Name
  const clientObj = s.client && typeof s.client === "object" ? (s.client as Record<string, unknown>) : null;
  const facility =
    (typeof s.facilityName === "string" ? s.facilityName.trim() : "") ||
    (clientObj && typeof clientObj.facilityName === "string" ? clientObj.facilityName.trim() : "");

  if (!facility) {
    return { complete: false, reason: "Snapshot enthält keine Kundeneinrichtung (facilityName fehlt)." };
  }

  // Client Address (Mandatory for Reproducible PDF)
  const address =
    (typeof s.address === "string" ? s.address.trim() : "") ||
    (clientObj && typeof clientObj.address === "string" ? clientObj.address.trim() : "");

  if (!address) {
    return { complete: false, reason: "Snapshot enthält keine Kundenadresse (address fehlt)." };
  }

  // Invoice Date (Mandatory for Reproducible PDF)
  const rawDate =
    s.date ||
    s.invoiceDate ||
    (invoiceContext?.date
      ? invoiceContext.date instanceof Date
        ? invoiceContext.date.toISOString()
        : String(invoiceContext.date)
      : null);

  if (!rawDate) {
    return { complete: false, reason: "Snapshot enthält kein Rechnungsdatum (date fehlt)." };
  }

  // Mandatory Totals Check: subtotal, taxAmount, total
  const hasRawSubtotal = s.subtotalCents !== undefined || s.subtotal !== undefined || s.netAmount !== undefined;
  const subtotalCents =
    typeof s.subtotalCents === "number" && !isNaN(s.subtotalCents)
      ? s.subtotalCents
      : parseCurrencyAmountToCents(s.subtotal ?? s.netAmount);

  if (!hasRawSubtotal || subtotalCents === null) {
    return { complete: false, reason: "Snapshot enthält keine Zwischensumme (subtotal fehlt)." };
  }

  const hasRawTax =
    s.taxAmountCents !== undefined ||
    s.taxAmount !== undefined ||
    s.vatAmount !== undefined ||
    s.vatAmountCents !== undefined;
  const taxAmountCents =
    typeof s.taxAmountCents === "number" && !isNaN(s.taxAmountCents)
      ? s.taxAmountCents
      : parseCurrencyAmountToCents(s.taxAmount ?? s.vatAmount);

  if (!hasRawTax || taxAmountCents === null) {
    return { complete: false, reason: "Snapshot enthält keinen Steuerbetrag (taxAmount/vatAmount fehlt)." };
  }

  const hasRawTotal =
    s.totalCents !== undefined ||
    s.total !== undefined ||
    s.grossAmount !== undefined ||
    s.grossAmountCents !== undefined;
  const totalCents =
    typeof s.totalCents === "number" && !isNaN(s.totalCents)
      ? s.totalCents
      : parseCurrencyAmountToCents(s.total ?? s.grossAmount);

  if (!hasRawTotal || totalCents === null) {
    return { complete: false, reason: "Snapshot enthält keinen Gesamtbetrag (total/grossAmount fehlt)." };
  }

  // Mathematical Integrity Check: Items Sum vs Snapshot Subtotal
  // Zero tolerance for arbitrary discrepancies. Exactly 1 cent discrepancy is documented legacy rounding flaw.
  const discrepancyCents = calculatedItemsNetCents - subtotalCents;
  let hasKnownRoundingDiscrepancy = false;
  let knownRoundingDiscrepancyCents: number | undefined = undefined;

  if (discrepancyCents !== 0) {
    if (Math.abs(discrepancyCents) === 1) {
      hasKnownRoundingDiscrepancy = true;
      knownRoundingDiscrepancyCents = discrepancyCents;
    } else {
      return {
        complete: false,
        reason: `Mathematische Inkonsistenz im Snapshot: Die Summe der Posten (${(calculatedItemsNetCents / 100).toFixed(2)} €) weicht um ${Math.abs(discrepancyCents)} Cent von der Zwischensumme (${(subtotalCents / 100).toFixed(2)} €) ab (keine bekannte 1-Cent-Rundungsdifferenz).`,
      };
    }
  }

  // Mathematical Integrity Check: Snapshot vs DB Amounts (if provided)
  // Subtotal in snapshot MUST match DB netAmount exactly (0 cents tolerance)
  if (invoiceContext?.netAmount !== undefined && invoiceContext.netAmount !== null) {
    const dbNetCents = Math.round(invoiceContext.netAmount * 100);
    if (subtotalCents !== dbNetCents) {
      return {
        complete: false,
        reason: `Mathematische Inkonsistenz: Die Zwischensumme des Snapshots (${(subtotalCents / 100).toFixed(2)} €) stimmt nicht mit dem Netto-Rechnungsbetrag der Datenbank (${invoiceContext.netAmount.toFixed(2)} €) überein.`,
      };
    }
  }

  // Tax in snapshot MUST match DB vatAmount exactly (0 cents tolerance)
  if (invoiceContext?.vatAmount !== undefined && invoiceContext.vatAmount !== null) {
    const dbVatCents = Math.round(invoiceContext.vatAmount * 100);
    if (taxAmountCents !== dbVatCents) {
      return {
        complete: false,
        reason: `Mathematische Inkonsistenz: Der Steuerbetrag des Snapshots (${(taxAmountCents / 100).toFixed(2)} €) stimmt nicht mit dem Steuerbetrag der Datenbank (${invoiceContext.vatAmount.toFixed(2)} €) überein.`,
      };
    }
  }

  // Gross total in snapshot MUST match DB grossAmount exactly (0 cents tolerance)
  if (invoiceContext?.grossAmount !== undefined && invoiceContext.grossAmount !== null) {
    const dbGrossCents = Math.round(invoiceContext.grossAmount * 100);
    if (totalCents !== dbGrossCents) {
      return {
        complete: false,
        reason: `Mathematische Inkonsistenz: Der Gesamtbetrag des Snapshots (${(totalCents / 100).toFixed(2)} €) stimmt nicht mit dem Brutto-Rechnungsbetrag der Datenbank (${invoiceContext.grossAmount.toFixed(2)} €) überein.`,
      };
    }
  }

  // Pre-flight PDF Renderer Simulation: verify PDF generation succeeds strictly from snapshot
  let generatedPdfBuffer: Buffer;
  try {
    const dummyClient = {
      id: (clientObj?.id as string) || "c-hist",
      facilityName: facility,
      address,
      billingEmail: (clientObj?.billingEmail as string) || null,
      billingInfo: (s.billingInfo as string) || (clientObj?.billingInfo as string) || null,
      shortCode: (clientObj?.shortCode as string) || null,
      internalNumber: (clientObj?.internalNumber as string) || null,
      paymentTermsDays:
        typeof s.paymentTermsDays === "number"
          ? s.paymentTermsDays
          : typeof clientObj?.paymentTermsDays === "number"
          ? clientObj.paymentTermsDays
          : 14,
      hourlyRates: {},
      surchargeSat: 0,
      surchargeSun: 0,
      surchargeHoliday: 0,
      surchargeNight: 0,
      nightStart: "22:00",
      nightEnd: "06:00",
    };

    const dummyInvoice = {
      invoiceNumber: (s.invoiceNumber as string) || invoiceContext?.invoiceNumber || "HIST-INV",
      date: new Date(rawDate as string),
      netAmount: subtotalCents / 100,
      vatAmount: taxAmountCents / 100,
      grossAmount: totalCents / 100,
      snapshotData: s,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = buildInvoicePdfData(dummyInvoice as any, dummyClient as any, []);
    if (!built || !built.clientName || !built.items || built.items.length === 0) {
      return {
        complete: false,
        reason: "Simulation der PDF-Erstellung aus dem historischen Snapshot schlug fehl: Unvollständige PDF-Datenstruktur.",
      };
    }

    // Strict verification of built PDF data figures and client identity
    if (built.clientName !== facility) {
      return {
        complete: false,
        reason: `Simulation der PDF-Erstellung ergab einen abweichenden Mandantennamen ("${built.clientName}") gegenüber dem Snapshot ("${facility}").`,
      };
    }

    const builtSubtotalCents = parseCurrencyAmountToCents(built.subtotal);
    const builtTaxCents = parseCurrencyAmountToCents(built.taxAmount);
    const builtTotalCents = parseCurrencyAmountToCents(built.total);

    if (builtSubtotalCents !== subtotalCents) {
      return {
        complete: false,
        reason: `Simulation der PDF-Erstellung ergab eine abweichende Zwischensumme (${built.subtotal}) gegenüber dem Snapshot (${(subtotalCents / 100).toFixed(2)} €).`,
      };
    }

    if (builtTaxCents !== taxAmountCents) {
      return {
        complete: false,
        reason: `Simulation der PDF-Erstellung ergab einen abweichenden Steuerbetrag (${built.taxAmount}) gegenüber dem Snapshot (${(taxAmountCents / 100).toFixed(2)} €).`,
      };
    }

    if (builtTotalCents !== totalCents) {
      return {
        complete: false,
        reason: `Simulation der PDF-Erstellung ergab einen abweichenden Gesamtbetrag (${built.total}) gegenüber dem Snapshot (${(totalCents / 100).toFixed(2)} €).`,
      };
    }

    generatedPdfBuffer = await generateInvoicePdf(built);
    if (
      !generatedPdfBuffer ||
      generatedPdfBuffer.length < 100 ||
      generatedPdfBuffer.toString("utf-8", 0, 5) !== "%PDF-"
    ) {
      return {
        complete: false,
        reason: "Pre-Flight-Prüfung der PDF-Generierung aus dem Snapshot ergab keine gültigen PDF-Bytes (Magic-Bytes '%PDF-' fehlen oder Puffer zu klein).",
      };
    }
  } catch (err) {
    return {
      complete: false,
      reason: `Simulation der PDF-Erstellung aus dem Snapshot schlug fehl: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const sha256 = createHash("sha256").update(JSON.stringify(snap)).digest("hex");
  return {
    complete: true,
    sha256,
    hasKnownRoundingDiscrepancy,
    knownRoundingDiscrepancyCents,
    pdfByteLength: generatedPdfBuffer.length,
  };
}

export async function checkReliableHistoricalOrigin(
  invoice: {
    id: string;
    invoiceNumber?: string;
    pdfUrl?: string | null;
    snapshotData?: unknown;
    netAmount?: number;
    vatAmount?: number;
    grossAmount?: number;
    date?: Date | string;
    client?: { facilityName?: string; address?: string | null } | null;
  },
  fileVerifier?: FileVerifier
): Promise<{
  reliable: boolean;
  source: "stored_pdf" | "frozen_snapshot" | "none";
  reason?: string;
  storedPdfInfo?: {
    path: string;
    sha256: string;
    byteLength: number;
  };
  frozenSnapshotSha256?: string;
  hasKnownRoundingDiscrepancy?: boolean;
  knownRoundingDiscrepancyCents?: number;
  pdfByteLength?: number;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  const candidatePdfUrl =
    (typeof invoice.pdfUrl === "string" && invoice.pdfUrl.trim().length > 0 ? invoice.pdfUrl.trim() : null) ||
    (snap && typeof snap.pdfUrl === "string" && snap.pdfUrl.trim().length > 0 ? snap.pdfUrl.trim() : null) ||
    (snap && typeof snap.pdfFilePath === "string" && snap.pdfFilePath.trim().length > 0 ? snap.pdfFilePath.trim() : null);

  if (candidatePdfUrl) {
    const verifier = fileVerifier || defaultFileVerifier;
    const fileCheck = await verifier(candidatePdfUrl);
    if (fileCheck.exists && fileCheck.sha256 && fileCheck.byteLength) {
      return {
        reliable: true,
        source: "stored_pdf",
        storedPdfInfo: {
          path: fileCheck.realPath || candidatePdfUrl,
          sha256: fileCheck.sha256,
          byteLength: fileCheck.byteLength,
        },
      };
    }
  }

  const snapshotCheck = await isCompleteFrozenSnapshot(invoice.snapshotData, invoice);
  if (snapshotCheck.complete) {
    return {
      reliable: true,
      source: "frozen_snapshot",
      frozenSnapshotSha256: snapshotCheck.sha256,
      hasKnownRoundingDiscrepancy: snapshotCheck.hasKnownRoundingDiscrepancy,
      knownRoundingDiscrepancyCents: snapshotCheck.knownRoundingDiscrepancyCents,
      pdfByteLength: snapshotCheck.pdfByteLength,
    };
  }

  const failureReason = candidatePdfUrl
    ? `Die angegebene PDF-Datei "${candidatePdfUrl}" existiert nicht auf dem Server, liegt außerhalb des sicheren Speichers oder konnte nicht verifiziert werden, und es liegen keine vollständigen eingefrorenen Snapshot-Posten vor.`
    : (snapshotCheck.reason || "Die Rechnung verfügt weder über eine verifizierte gespeicherte PDF-Datei noch über einen vollständigen eingefrorenen Snapshot.");

  return {
    reliable: false,
    source: "none",
    reason: failureReason,
  };
}

export async function hasReliableHistoricalOrigin(invoice: {
  id?: string;
  pdfUrl?: string | null;
  snapshotData?: unknown;
  netAmount?: number;
  grossAmount?: number;
  date?: Date | string;
  client?: { facilityName?: string; address?: string | null } | null;
}): Promise<{ reliable: boolean; source: "stored_pdf" | "frozen_snapshot" | "none"; reason?: string }> {
  const defaultCheck = await isCompleteFrozenSnapshot(invoice.snapshotData, invoice);
  if (defaultCheck.complete) {
    return { reliable: true, source: "frozen_snapshot" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  const rawUrl = invoice.pdfUrl || snap?.pdfUrl || snap?.pdfFilePath;
  if (typeof rawUrl === "string" && rawUrl.trim().length > 0) {
    const fileCheck = defaultFileVerifier(rawUrl.trim());
    if (fileCheck.exists) {
      return { reliable: true, source: "stored_pdf" };
    }
  }
  return {
    reliable: false,
    source: "none",
    reason: defaultCheck.reason || "Weder verifizierte Datei noch vollständiger Snapshot vorhanden.",
  };
}

export type InvoiceRevisionState = {
  mode: "legacy_initial" | "successive";
  baseRevisionNumber: number;
  targetRevisionNumber: number;
  revisions: Array<{ id: string; revisionNumber: number }>;
};

export async function determineInvoiceRevisionState(
  invoice: { id: string; invoiceNumber: string; snapshotData?: unknown },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbOrTx: any
): Promise<InvoiceRevisionState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  const isV2 = isV2CalculationVersion(snap);

  let revisions: Array<{ id: string; revisionNumber: number }> = [];
  if (dbOrTx.invoiceRevision && typeof dbOrTx.invoiceRevision.findMany === "function") {
    revisions = await dbOrTx.invoiceRevision.findMany({
      where: { invoiceId: invoice.id },
      select: { id: true, revisionNumber: true },
      orderBy: { revisionNumber: "asc" },
    });
  } else if (dbOrTx.invoiceRevision && typeof dbOrTx.invoiceRevision.count === "function") {
    const count = await dbOrTx.invoiceRevision.count({ where: { invoiceId: invoice.id } });
    revisions = Array.from({ length: count }, (_, i) => ({ id: `rev-${i + 1}`, revisionNumber: i + 1 }));
  }

  const revisionCount = revisions.length;

  // Case 1: Freshly issued V2 invoice without revision history -> Strictly IMMUTABLE
  if (isV2 && revisionCount === 0) {
    throw new FreshV2InvoiceImmutableError(invoice.invoiceNumber);
  }

  // Case 2: Legacy invoice entering Phase 6 refresh for the first time
  if (!isV2 && revisionCount === 0) {
    return {
      mode: "legacy_initial",
      baseRevisionNumber: 0,
      targetRevisionNumber: 1,
      revisions: [],
    };
  }

  // Case 3: Successive revisions (Rev 1 -> Rev 2, Rev 2 -> Rev 3)
  if (revisionCount > 0) {
    if (!isV2) {
      throw new RevisionChainCorruptedError(
        `[REVISION_CHAIN_CORRUPTED] Rechnung "${invoice.invoiceNumber}" hat ${revisionCount} Revisionen, aber der Snapshot weist keine gültige V2-Berechnung auf.`
      );
    }

    // Verify monotonic sequencing: 1, 2, 3...
    for (let i = 0; i < revisions.length; i++) {
      if (revisions[i].revisionNumber !== i + 1) {
        throw new RevisionChainCorruptedError(
          `[REVISION_CHAIN_CORRUPTED] Lücke oder Inkonsistenz in der Revisionskette von Rechnung "${invoice.invoiceNumber}": Revision ${i + 1} erwartet, aber ${revisions[i].revisionNumber} gefunden.`
        );
      }
    }

    const highestRevisionNumber = revisions[revisions.length - 1].revisionNumber;
    const snapRevisionNumber = Number(snap?.revisionNumber);

    if (isNaN(snapRevisionNumber) || snapRevisionNumber !== highestRevisionNumber) {
      throw new RevisionChainCorruptedError(
        `[REVISION_CHAIN_CORRUPTED] Inkonsistenz in der Revisionskette von Rechnung "${invoice.invoiceNumber}": Revisionsnummer im Snapshot (${snap?.revisionNumber}) stimmt nicht mit der höchsten gespeicherten Revision (${highestRevisionNumber}) überein.`
      );
    }

    return {
      mode: "successive",
      baseRevisionNumber: highestRevisionNumber,
      targetRevisionNumber: highestRevisionNumber + 1,
      revisions,
    };
  }

  throw new RevisionChainCorruptedError(
    `[REVISION_CHAIN_CORRUPTED] Unbekannter Revisionszustand für Rechnung "${invoice.invoiceNumber}".`
  );
}

// ============================================================================
// Types
// ============================================================================

export type V2InvoiceRefreshPreview = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  status: string;
  isSent: boolean;
  baseRevisionNumber: number;
  targetRevisionNumber: number;
  client: {
    id: string;
    facilityName: string;
    shortCode: string | null;
    internalNumber: string | null;
  };
  historical: {
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
    formattedNet: string;
    formattedVat: string;
    formattedGross: string;
    assignmentCount: number;
    hasStoredPdfFile: boolean;
    originReliability: "stored_pdf" | "frozen_snapshot" | "none";
    snapshotData: unknown;
  };
  proposed: {
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
    formattedNet: string;
    formattedVat: string;
    formattedGross: string;
    diffNet: number;
    diffGross: number;
    formattedDiffNet: string;
    formattedDiffGross: string;
    items: V2InvoicePdfItem[];
    assignmentCount: number;
  };
  provenance: {
    assignmentIds: string[];
    policyVersions: Array<{
      policyId: string;
      policyVersion: number;
      frozenHash: string;
    }>;
    priceVersions: Array<{
      priceVersionId: string;
      qualification: string;
      hourlyRateInCents: number;
      sourceReference: string;
    }>;
  };
  previewToken: string;
  previewGeneratedAt: string;
  previewExpiresAt: string;
};

export type V2RefreshDeps = {
  adminId?: string;
  currentTime?: number;
  secret?: string;
  fileVerifier?: FileVerifier;
  archivePdfFn?: (
    sourcePath: string,
    invoiceId: string,
    expectedSha256?: string
  ) => Promise<ArchivedPdfResult> | ArchivedPdfResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any;
  priceVersionResolver?: PriceVersionResolver;
  facilityPolicyResolver?: FacilityPolicyResolver;
  effectiveHoursResolver?: EffectiveHoursResolver;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txAuditLogFn?: (entry: any, tx: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lockInvoiceAndAssignmentsFn?: (invoiceId: string, assignmentIds: string[], tx: any) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceConcurrencyGuardFn?: (assignmentIds: string[], tx: any) => Promise<void>;
};

// ============================================================================
// Step 1: Preview V2 Invoice Refresh
// ============================================================================

export async function previewV2InvoiceRefresh(
  invoiceId: string,
  optionsOrDeps?: ({ adminId?: string } & V2RefreshDeps) | V2RefreshDeps
): Promise<V2InvoiceRefreshPreview> {
  const deps = optionsOrDeps;
  const db = deps?.prisma || prisma;
  const adminId = deps?.adminId || "admin-system";

  // 1. Strict secret pre-validation before preview
  getRefreshSecret(deps?.secret);

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      assignments: {
        select: { id: true, invoiceId: true },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!invoice) {
    throw new InvoiceNotFoundError(invoiceId);
  }

  if (invoice.status === "cancelled") {
    throw new InvoiceCancelledError(invoiceId);
  }

  if (invoice.status === "paid") {
    throw new InvoiceAlreadyPaidError(invoiceId);
  }

  // Sent invoices fail closed immediately
  if (isInvoiceSent(invoice)) {
    throw new SentInvoiceRefreshNotPermittedError(invoice.invoiceNumber);
  }

  if (invoice.assignments.length === 0) {
    throw new NoAssignmentsLinkedError(invoiceId);
  }

  // Successive revision tracking and fresh V2 immutability guard
  const revisionState = await determineInvoiceRevisionState(invoice, db);
  const baseRevisionNumber = revisionState.baseRevisionNumber;
  const targetRevisionNumber = revisionState.targetRevisionNumber;

  // Check historical origin reliability standard
  const originCheck = await checkReliableHistoricalOrigin(invoice, deps?.fileVerifier);
  if (!originCheck.reliable) {
    throw new UnreliableHistoricalOriginError(invoiceId, originCheck.reason);
  }

  const assignmentIds = invoice.assignments.map((a: { id: string }) => a.id);

  // Prepare V2 draft specifically bound to this invoice's assignments
  const { prepareV2InvoiceDraft, convertCalculatedLineItemsToPdfItems } = await import(
    "./invoice-v2-draft-service"
  );

  const draftDeps: V2DraftDependencies = {
    prisma: db,
    priceVersionResolver: deps?.priceVersionResolver,
    facilityPolicyResolver: deps?.facilityPolicyResolver,
    effectiveHoursResolver: deps?.effectiveHoursResolver,
  };

  const draftResult = await prepareV2InvoiceDraft(
    {
      assignmentIds,
      allowBilledForInvoiceId: invoice.id,
    },
    draftDeps
  );

  if (draftResult.status === "unresolved") {
    throw new InvoiceRefreshError(
      draftResult.code,
      `[${draftResult.code}] V2-Entwurfsvorbereitung für Rechnung "${invoice.invoiceNumber}" fehlgeschlagen: ${draftResult.message}`,
      draftResult.diagnostics
    );
  }

  const previousGrossCents = roundToCents(invoice.grossAmount);
  const newGrossCents = draftResult.totals.totalCents;
  const draftHash = computeV2DraftHash(draftResult);
  const invoiceStateHash = computeInvoiceStateHash(invoice);

  const issuedAt = deps?.currentTime ?? Date.now();
  const ttlMs = 15 * 60 * 1000;
  const previewToken = computeRefreshPreviewToken({
    invoiceId: invoice.id,
    adminId,
    previousGrossCents,
    newGrossCents,
    invoiceStateHash,
    draftHash,
    baseRevisionNumber,
    assignmentIds,
    issuedAt,
    ttlMs,
    secret: deps?.secret,
  });

  const newNet = draftResult.totals.subtotalCents / 100;
  const newVat = draftResult.totals.taxAmountCents / 100;
  const newGross = draftResult.totals.totalCents / 100;

  const diffNet = Number((newNet - invoice.netAmount).toFixed(2));
  const diffGross = Number((newGross - invoice.grossAmount).toFixed(2));

  const formatDiff = (cents: number) => {
    const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${formatCentsGerman(abs)}`;
  };

  const pdfItems = draftResult.pdfItems ?? convertCalculatedLineItemsToPdfItems(draftResult.items);
  const isSent = isInvoiceSent(invoice);

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date instanceof Date ? invoice.date.toISOString() : String(invoice.date),
    status: invoice.status,
    isSent,
    baseRevisionNumber,
    targetRevisionNumber,
    client: {
      id: invoice.client.id,
      facilityName: invoice.client.facilityName,
      shortCode: invoice.client.shortCode || null,
      internalNumber: invoice.client.internalNumber || null,
    },
    historical: {
      netAmount: invoice.netAmount,
      vatAmount: invoice.vatAmount,
      grossAmount: invoice.grossAmount,
      formattedNet: formatCentsGerman(roundToCents(invoice.netAmount)),
      formattedVat: formatCentsGerman(roundToCents(invoice.vatAmount)),
      formattedGross: formatCentsGerman(roundToCents(invoice.grossAmount)),
      assignmentCount: invoice.assignments.length,
      hasStoredPdfFile: originCheck.source === "stored_pdf",
      originReliability: originCheck.source,
      snapshotData: invoice.snapshotData ?? null,
    },
    proposed: {
      netAmount: newNet,
      vatAmount: newVat,
      grossAmount: newGross,
      formattedNet: draftResult.totals.subtotalDisplay,
      formattedVat: draftResult.totals.taxAmountDisplay,
      formattedGross: draftResult.totals.totalDisplay,
      diffNet,
      diffGross,
      formattedDiffNet: formatDiff(roundToCents(diffNet)),
      formattedDiffGross: formatDiff(roundToCents(diffGross)),
      items: pdfItems,
      assignmentCount: assignmentIds.length,
    },
    provenance: {
      assignmentIds,
      policyVersions: draftResult.provenance.policyVersions,
      priceVersions: draftResult.provenance.priceVersions,
    },
    previewToken,
    previewGeneratedAt: new Date(issuedAt).toISOString(),
    previewExpiresAt: new Date(issuedAt + ttlMs).toISOString(),
  };
}

// ============================================================================
// Step 2: Confirm V2 Invoice Refresh
// ============================================================================

export type ConfirmV2RefreshInput = {
  invoiceId: string;
  previewToken: string;
  reason?: string;
  performedByUserId: string;
  confirmSentInvoiceUpdate?: boolean;
};

export type ConfirmV2RefreshResult = {
  success: true;
  invoiceId: string;
  invoiceNumber: string;
  revisionNumber: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
};

export async function confirmV2InvoiceRefresh(
  input: ConfirmV2RefreshInput,
  deps?: V2RefreshDeps
): Promise<ConfirmV2RefreshResult> {
  // 1. Strict Server Feature Flag Guard
  if (!isV2RefreshEnabled()) {
    throw new FeatureDisabledError();
  }

  // 2. Strict HMAC Secret Guard before any DB transaction
  getRefreshSecret(deps?.secret);

  const db = deps?.prisma || prisma;
  const issuedAt = new Date().toISOString();

  try {
    const result = await db.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        // Concurrency Protocol Step A: Row locking on the invoice and its assignments
        const initialInvoice = await tx.invoice.findUnique({
          where: { id: input.invoiceId },
          include: {
            assignments: { select: { id: true } },
          },
        });

        if (!initialInvoice) {
          throw new InvoiceNotFoundError(input.invoiceId);
        }

        const assignmentIds = initialInvoice.assignments.map((a: { id: string }) => a.id);
        const sortedAssignmentIds = [...assignmentIds].sort();

        if (deps?.lockInvoiceAndAssignmentsFn) {
          await deps.lockInvoiceAndAssignmentsFn(input.invoiceId, sortedAssignmentIds, tx);
        } else if (typeof tx.$queryRaw === "function") {
          // Explicit physical table names and deterministic ordering
          const lockAssignmentsQuery = Prisma.sql`SELECT id FROM "assignments" WHERE id IN (${Prisma.join(sortedAssignmentIds)}) ORDER BY id FOR UPDATE`;
          const lockedAssignments = (await tx.$queryRaw(lockAssignmentsQuery)) as unknown as Array<{ id: string }>;

          if (!Array.isArray(lockedAssignments) || lockedAssignments.length !== sortedAssignmentIds.length) {
            throw new ConcurrentModificationError(
              `Sperrkonflikt: Es konnten nur ${Array.isArray(lockedAssignments) ? lockedAssignments.length : 0} von ${sortedAssignmentIds.length} Schichten exklusiv gesperrt werden.`
            );
          }

          const lockInvoiceQuery = Prisma.sql`SELECT id FROM "invoices" WHERE id = ${input.invoiceId} FOR UPDATE`;
          const lockedInvoice = (await tx.$queryRaw(lockInvoiceQuery)) as unknown as Array<{ id: string }>;

          if (!Array.isArray(lockedInvoice) || lockedInvoice.length !== 1) {
            throw new ConcurrentModificationError(
              `Sperrkonflikt: Rechnung "${input.invoiceId}" konnte nicht exklusiv gesperrt werden.`
            );
          }
        } else {
          throw new Error(
            "Keine Implementierung für die exklusive Sperrung (FOR UPDATE) in der Transaktion verfügbar."
          );
        }

        // Concurrency Protocol Step B: Re-verify invoice state after acquiring exclusive locks
        const invoice = await tx.invoice.findUnique({
          where: { id: input.invoiceId },
          include: {
            client: true,
            assignments: {
              include: {
                worker: true,
                order: true,
              },
              orderBy: { id: "asc" },
            },
          },
        });

        if (!invoice) {
          throw new InvoiceNotFoundError(input.invoiceId);
        }

        if (invoice.status === "cancelled") {
          throw new InvoiceCancelledError(input.invoiceId);
        }

        if (invoice.status === "paid") {
          throw new InvoiceAlreadyPaidError(input.invoiceId);
        }

        // Sent invoice protection: Fail-Closed
        if (isInvoiceSent(invoice)) {
          throw new SentInvoiceRefreshNotPermittedError(invoice.invoiceNumber);
        }

        // Determine base revision number and verify revision chain (fresh V2 immutability guard)
        const revisionState = await determineInvoiceRevisionState(invoice, tx);
        const baseRevisionNumber = revisionState.baseRevisionNumber;
        const nextRevisionNumber = revisionState.targetRevisionNumber;

        const originCheck = await checkReliableHistoricalOrigin(invoice, deps?.fileVerifier);
        if (!originCheck.reliable) {
          throw new UnreliableHistoricalOriginError(input.invoiceId, originCheck.reason);
        }

        // Concurrency Protocol Step C: In-transaction draft re-preparation
        const { prepareV2InvoiceDraft, convertCalculatedLineItemsToPdfItems } = await import(
          "./invoice-v2-draft-service"
        );

        const draftDeps: V2DraftDependencies = {
          prisma: tx,
          priceVersionResolver: deps?.priceVersionResolver,
          facilityPolicyResolver: deps?.facilityPolicyResolver,
          effectiveHoursResolver: deps?.effectiveHoursResolver,
        };

        const inTxDraft = await prepareV2InvoiceDraft(
          {
            assignmentIds: sortedAssignmentIds,
            allowBilledForInvoiceId: invoice.id,
          },
          draftDeps
        );

        if (inTxDraft.status === "unresolved") {
          throw new StalePreviewError(
            `Die Neuberechnung schlug während der Transaktion fehl: ${inTxDraft.message}`
          );
        }

        const inTxDraftHash = computeV2DraftHash(inTxDraft);
        const inTxInvoiceStateHash = computeInvoiceStateHash(invoice);

        // Concurrency Protocol Step D: Verify HMAC Preview Token
        const verification = verifyRefreshPreviewToken(input.previewToken, {
          invoiceId: invoice.id,
          adminId: input.performedByUserId,
          previousGrossCents: roundToCents(invoice.grossAmount),
          newGrossCents: inTxDraft.totals.totalCents,
          invoiceStateHash: inTxInvoiceStateHash,
          draftHash: inTxDraftHash,
          baseRevisionNumber,
          assignmentIds: sortedAssignmentIds,
          currentTime: deps?.currentTime,
          secret: deps?.secret,
        });

        if (!verification.valid) {
          throw new StalePreviewError(
            `Berechnungstoken ungültig oder abgelaufen [${verification.code}]: ${verification.message}`
          );
        }

        // Concurrency Protocol Step E: Optional Simulator Guard Hook
        if (deps?.sourceConcurrencyGuardFn) {
          await deps.sourceConcurrencyGuardFn(sortedAssignmentIds, tx);
        }

        // Step F: Monotonic Revision Sequencing
        if (!tx.invoiceRevision || typeof tx.invoiceRevision.create !== "function") {
          throw new InvoiceRefreshError(
            "REVISION_CREATION_FAILED",
            "[REVISION_CREATION_FAILED] Mandatorisches InvoiceRevision-Delegate fehlt in der Transaktion. Abbruch (Fail-Closed)."
          );
        }

        const inTxNet = inTxDraft.totals.subtotalCents / 100;
        const inTxVat = inTxDraft.totals.taxAmountCents / 100;
        const inTxGross = inTxDraft.totals.totalCents / 100;

        const tokenHash = maskTokenForAudit(input.previewToken);

        // Archive original PDF prior to invoice update if originCheck is stored_pdf (Fail-Closed)
        let archivedPdfRecord: ArchivedPdfResult | null = null;
        if (originCheck.source === "stored_pdf" && originCheck.storedPdfInfo) {
          if (deps?.archivePdfFn) {
            archivedPdfRecord = await deps.archivePdfFn(
              originCheck.storedPdfInfo.path,
              invoice.id,
              originCheck.storedPdfInfo.sha256
            );
          } else {
            archivedPdfRecord = await persistArchivedOriginalPdf(
              originCheck.storedPdfInfo.path,
              invoice.id,
              originCheck.storedPdfInfo.sha256,
              deps?.fileVerifier
            );
          }
        }

        const rawSnap = (invoice.snapshotData && typeof invoice.snapshotData === "object"
          ? invoice.snapshotData
          : {}) as Record<string, unknown>;
        const snapClient = (rawSnap.client && typeof rawSnap.client === "object"
          ? rawSnap.client
          : null) as Record<string, unknown> | null;

        const isFrozenSnapOrigin = originCheck.source === "frozen_snapshot";

        const histFacilityName =
          (typeof rawSnap.facilityName === "string" && rawSnap.facilityName.trim()) ||
          (typeof snapClient?.facilityName === "string" && snapClient.facilityName.trim()) ||
          null;
        const histAddress =
          (typeof rawSnap.address === "string" && rawSnap.address.trim()) ||
          (typeof snapClient?.address === "string" && snapClient.address.trim()) ||
          null;
        const histShortCode =
          (typeof rawSnap.shortCode === "string" && rawSnap.shortCode.trim()) ||
          (typeof snapClient?.shortCode === "string" && snapClient.shortCode.trim()) ||
          null;
        const histInternalNumber =
          (typeof rawSnap.internalNumber === "string" && rawSnap.internalNumber.trim()) ||
          (typeof snapClient?.internalNumber === "string" && snapClient.internalNumber.trim()) ||
          null;
        const histBillingEmail =
          (typeof rawSnap.billingEmail === "string" && rawSnap.billingEmail.trim()) ||
          (typeof snapClient?.billingEmail === "string" && snapClient.billingEmail.trim()) ||
          null;
        const histBillingInfo =
          (typeof rawSnap.billingInfo === "string" && rawSnap.billingInfo.trim()) ||
          (typeof snapClient?.billingInfo === "string" && snapClient.billingInfo.trim()) ||
          null;
        const histPaymentTermsDays =
          typeof rawSnap.paymentTermsDays === "number"
            ? rawSnap.paymentTermsDays
            : typeof snapClient?.paymentTermsDays === "number"
            ? snapClient.paymentTermsDays
            : isFrozenSnapOrigin
            ? 14
            : invoice.client.paymentTermsDays;

        // Complete Previous Provenance Record
        const previousProvenanceSnapshot = {
          invoiceNumber: invoice.invoiceNumber,
          date: invoice.date instanceof Date ? invoice.date.toISOString() : String(invoice.date),
          dueDate: invoice.dueDate
            ? invoice.dueDate instanceof Date
              ? invoice.dueDate.toISOString()
              : String(invoice.dueDate)
            : null,
          clientId: (snapClient?.id as string) || (rawSnap.clientId as string) || invoice.clientId,
          client: {
            id: (snapClient?.id as string) || (rawSnap.clientId as string) || (isFrozenSnapOrigin ? "HISTORICAL-CLIENT" : invoice.client.id),
            facilityName: histFacilityName || (isFrozenSnapOrigin ? null : invoice.client.facilityName),
            shortCode: histShortCode || (isFrozenSnapOrigin ? null : invoice.client.shortCode || null),
            internalNumber: histInternalNumber || (isFrozenSnapOrigin ? null : invoice.client.internalNumber || null),
            address: histAddress || (isFrozenSnapOrigin ? null : invoice.client.address || null),
            billingEmail: histBillingEmail || (isFrozenSnapOrigin ? null : invoice.client.billingEmail || null),
            billingInfo: histBillingInfo || (isFrozenSnapOrigin ? null : invoice.client.billingInfo || null),
            paymentTermsDays: histPaymentTermsDays,
          },
          liveClientAtRefresh: {
            id: invoice.client.id,
            facilityName: invoice.client.facilityName,
            shortCode: invoice.client.shortCode || null,
            internalNumber: invoice.client.internalNumber || null,
            address: invoice.client.address || null,
            billingEmail: invoice.client.billingEmail || null,
            billingInfo: invoice.client.billingInfo || null,
            paymentTermsDays: invoice.client.paymentTermsDays,
          },
          netAmount: Number(invoice.netAmount),
          vatAmount: Number(invoice.vatAmount),
          grossAmount: Number(invoice.grossAmount),
          taxRate: Number(invoice.taxRate),
          status: invoice.status,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          assignments: (invoice.assignments || []).map((a: any) => ({
            id: a.id,
            orderId: a.orderId,
            workerId: a.workerId,
            shiftDate: a.order?.shiftDate
              ? a.order.shiftDate instanceof Date
                ? a.order.shiftDate.toISOString()
                : String(a.order.shiftDate)
              : null,
            qualification: a.order?.requiredQualification || null,
            workerName: a.worker?.fullName || null,
            hours: a.hours ?? null,
          })),
          assignmentIds: sortedAssignmentIds,
          archivedAt: issuedAt,
          archivedByUserId: input.performedByUserId,
          rawSnapshotData: invoice.snapshotData ?? null,
          hasStoredPdfFile: originCheck.source === "stored_pdf",
          pdfUrl:
            archivedPdfRecord?.archivedPath ||
            originCheck.storedPdfInfo?.path ||
            invoice.pdfUrl ||
            (invoice.snapshotData && typeof invoice.snapshotData === "object" && "pdfUrl" in invoice.snapshotData && typeof (invoice.snapshotData as Record<string, unknown>).pdfUrl === "string"
              ? ((invoice.snapshotData as Record<string, unknown>).pdfUrl as string)
              : null),
          originReliability: originCheck.source,
          storedPdfInfo: originCheck.storedPdfInfo
            ? {
                ...originCheck.storedPdfInfo,
                archivedPath: archivedPdfRecord?.archivedPath ?? null,
              }
            : null,
          archivedPdfRecord: archivedPdfRecord || null,
          frozenSnapshotSha256: originCheck.frozenSnapshotSha256 || null,
          isByteForByteOriginalFile: originCheck.source === "stored_pdf",
          isRegeneratedFromFrozenData: originCheck.source === "frozen_snapshot",
        };

        // Build frozen snapshotData for V2 (ensuring all client attributes exist at top level for PDF builder)
        const pdfItems = inTxDraft.pdfItems ?? convertCalculatedLineItemsToPdfItems(inTxDraft.items);
        const frozenSnapshotData = {
          ...inTxDraft.snapshotData,
          facilityName: inTxDraft.clientInfo.facilityName,
          internalNumber: inTxDraft.clientInfo.internalNumber || null,
          shortCode: inTxDraft.clientInfo.shortCode || null,
          address: inTxDraft.clientInfo.address || null,
          billingEmail: inTxDraft.clientInfo.billingEmail || null,
          billingInfo: inTxDraft.clientInfo.billingInfo || null,
          paymentTermsDays: inTxDraft.clientInfo.paymentTermsDays,
          calculationVersion: "v2" as const,
          isFrozen: true,
          refreshedAt: issuedAt,
          refreshedById: input.performedByUserId,
          revisionNumber: nextRevisionNumber,
          baseRevisionNumber,
          revisionReason: input.reason || null,
          previousGrossAmount: invoice.grossAmount,
          newGrossAmount: inTxGross,
          previewTokenHash: tokenHash,
          draftHash: inTxDraftHash,
          previousRevision: {
            revisionNumber: baseRevisionNumber,
            netAmount: invoice.netAmount,
            vatAmount: invoice.vatAmount,
            grossAmount: invoice.grossAmount,
            status: invoice.status,
            snapshotData: invoice.snapshotData ?? null,
            hasStoredPdfFile: originCheck.source === "stored_pdf",
            originReliability: originCheck.source,
            storedPdfInfo: originCheck.storedPdfInfo
              ? {
                  ...originCheck.storedPdfInfo,
                  archivedPath: archivedPdfRecord?.archivedPath ?? null,
                }
              : null,
            archivedPdfRecord: archivedPdfRecord || null,
          },
          subtotalCents: inTxDraft.totals.subtotalCents,
          taxAmountCents: inTxDraft.totals.taxAmountCents,
          totalCents: inTxDraft.totals.totalCents,
          subtotal: inTxDraft.totals.subtotalDisplay,
          taxAmount: inTxDraft.totals.taxAmountDisplay,
          total: inTxDraft.totals.totalDisplay,
          periodStart: inTxDraft.periodStart,
          periodEnd: inTxDraft.periodEnd,
          periodDisplay: inTxDraft.periodDisplay,
          client: inTxDraft.clientInfo,
          items: inTxDraft.items,
          pdfItems,
          provenance: inTxDraft.provenance,
        };

        // Step G: Archive Previous Revision Record (Mandatory)
        await tx.invoiceRevision.create({
          data: {
            invoiceId: invoice.id,
            revisionNumber: nextRevisionNumber,
            createdById: input.performedByUserId,
            reason: input.reason || null,
            previousStatus: invoice.status,
            previousNetAmount: invoice.netAmount,
            previousVatAmount: invoice.vatAmount,
            previousGrossAmount: invoice.grossAmount,
            previousSnapshotData: previousProvenanceSnapshot as unknown as Prisma.InputJsonValue,
            newNetAmount: inTxNet,
            newVatAmount: inTxVat,
            newGrossAmount: inTxGross,
            newSnapshotData: frozenSnapshotData as unknown as Prisma.InputJsonValue,
            previewToken: tokenHash,
          },
        });

        // Step H: Update Target Invoice Record (net, vat, gross, snapshotData)
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            netAmount: inTxNet,
            vatAmount: inTxVat,
            grossAmount: inTxGross,
            snapshotData: frozenSnapshotData as unknown as Prisma.InputJsonValue,
          },
        });

        // Step I: Mandatory Atomic In-Transaction Audit Log
        const auditPayload = {
          userId: input.performedByUserId,
          action: "invoice.v2_refresh",
          entity: "Invoice",
          entityId: invoice.id,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            revisionNumber: nextRevisionNumber,
            baseRevisionNumber,
            previousGross: invoice.grossAmount,
            newGross: inTxGross,
            diffGross: Number((inTxGross - invoice.grossAmount).toFixed(2)),
            diffNet: Number((inTxNet - invoice.netAmount).toFixed(2)),
            tokenHash,
            isSentRevised: false,
            calculationVersion: "v2",
            assignmentCount: sortedAssignmentIds.length,
          },
        };

        if (deps?.txAuditLogFn) {
          await deps.txAuditLogFn(auditPayload, tx);
        } else if (tx.auditLog && typeof tx.auditLog.create === "function") {
          await tx.auditLog.create({
            data: auditPayload,
          });
        } else {
          throw new Error(
            "Kein transaktionaler Audit-Log-Handler verfügbar. Rechnungsaktualisierung abgebrochen."
          );
        }

        return {
          success: true as const,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          revisionNumber: nextRevisionNumber,
          netAmount: inTxNet,
          vatAmount: inTxVat,
          grossAmount: inTxGross,
        };
      },
      {
        isolationLevel: "Serializable",
        timeout: 15000,
      }
    );

    return result;
  } catch (txErr) {
    const txErrObj = txErr as { code?: string; message?: string } | undefined;

    // Prisma Serialization Failure (P2034) or Concurrency conflict / Lock Timeout / Deadlock
    if (
      txErrObj?.code === "P2034" ||
      txErrObj?.code === "55P03" ||
      txErrObj?.code === "40P01" ||
      String(txErrObj?.message).includes("P2034") ||
      String(txErrObj?.message).toLowerCase().includes("could not serialize") ||
      String(txErrObj?.message).toLowerCase().includes("serialization failure") ||
      String(txErrObj?.message).toLowerCase().includes("deadlock detected") ||
      String(txErrObj?.message).toLowerCase().includes("could not obtain lock") ||
      String(txErrObj?.message).toLowerCase().includes("lock_not_available")
    ) {
      throw new ConcurrentModificationError(
        "Gleichzeitiger Transaktionskonflikt bei der Rechnungsaktualisierung. Bitte wiederholen."
      );
    }

    throw txErr;
  }
}
