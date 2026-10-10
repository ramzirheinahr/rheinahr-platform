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

export class UnreliableHistoricalOriginError extends InvoiceRefreshError {
  constructor(invoiceId: string, message?: string) {
    super(
      "UNRELIABLE_HISTORICAL_DOCUMENT",
      message ||
        `Historische Rechnung "${invoiceId}" verfügt weder über eine gespeicherte PDF-Datei noch über eingefrorene Postendaten im Snapshot. Eine Aktualisierung wird abgelehnt, um den Verlust der Originalfassung zu verhindern.`
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

function getRefreshSecret(): string {
  return (
    process.env.INVOICE_REFRESH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "rheinahr-invoice-v2-secure-refresh-secret-key-2026"
  );
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
  const secret = params.secret || getRefreshSecret();
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
  const secret = expected.secret || getRefreshSecret();
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

export function isInvoiceSent(invoice: { snapshotData?: unknown }): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  if (!snap || typeof snap !== "object") return false;
  return Boolean(snap.emailSent || snap.sentAt || snap.emailSentAt);
}

export function hasReliableHistoricalOrigin(invoice: {
  pdfUrl?: string | null;
  snapshotData?: unknown;
}): { reliable: boolean; source: "stored_pdf" | "frozen_snapshot" | "none"; reason?: string } {
  if (typeof invoice.pdfUrl === "string" && invoice.pdfUrl.trim().length > 0) {
    return { reliable: true, source: "stored_pdf" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  if (snap && typeof snap === "object") {
    if (typeof snap.pdfUrl === "string" && snap.pdfUrl.trim().length > 0) {
      return { reliable: true, source: "stored_pdf" };
    }
    if (isV2CalculationVersion(snap)) {
      return { reliable: true, source: "frozen_snapshot" };
    }
    if (Array.isArray(snap.items) && snap.items.length > 0) {
      return { reliable: true, source: "frozen_snapshot" };
    }
    if (Array.isArray(snap.pdfItems) && snap.pdfItems.length > 0) {
      return { reliable: true, source: "frozen_snapshot" };
    }
  }

  return {
    reliable: false,
    source: "none",
    reason:
      "Die Rechnung verfügt weder über eine hinterlegte PDF-Datei noch über eingefrorene Posten im Snapshot (snapshotData). Ein verlässliches historisches Dokument kann nicht garantiert werden.",
  };
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

  // Check historical origin reliability standard
  const originCheck = hasReliableHistoricalOrigin(invoice);
  if (!originCheck.reliable) {
    throw new UnreliableHistoricalOriginError(invoiceId, originCheck.reason);
  }

  if (invoice.assignments.length === 0) {
    throw new NoAssignmentsLinkedError(invoiceId);
  }

  const assignmentIds = invoice.assignments.map((a: { id: string }) => a.id);

  // Successive revision tracking
  let baseRevisionNumber = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = invoice.snapshotData as any;
  if (isV2CalculationVersion(snap)) {
    baseRevisionNumber = Number(snap?.revisionNumber) || 1;
  } else if (db.invoiceRevision && typeof db.invoiceRevision.count === "function") {
    baseRevisionNumber = await db.invoiceRevision.count({ where: { invoiceId: invoice.id } });
  }

  const targetRevisionNumber = baseRevisionNumber + 1;

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
      hasStoredPdfFile: Boolean(invoice.pdfUrl || snap?.pdfUrl),
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

        const originCheck = hasReliableHistoricalOrigin(invoice);
        if (!originCheck.reliable) {
          throw new UnreliableHistoricalOriginError(input.invoiceId, originCheck.reason);
        }

        // Check sent state protection
        const isSent = isInvoiceSent(invoice);
        if (isSent && !input.confirmSentInvoiceUpdate) {
          throw new SentInvoiceConfirmationRequiredError(
            `Rechnung "${invoice.invoiceNumber}" wurde bereits an den Kunden versandt. Eine Aktualisierung erfordert eine ausdrückliche Bestätigung (confirmSentInvoiceUpdate: true).`
          );
        }

        // Determine base revision number from locked invoice
        let baseRevisionNumber = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const snap = invoice.snapshotData as any;
        if (isV2CalculationVersion(snap)) {
          baseRevisionNumber = Number(snap?.revisionNumber) || 1;
        } else if (tx.invoiceRevision && typeof tx.invoiceRevision.count === "function") {
          baseRevisionNumber = await tx.invoiceRevision.count({ where: { invoiceId: invoice.id } });
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

        const existingRevisionCount = await tx.invoiceRevision.count({
          where: { invoiceId: invoice.id },
        });
        const nextRevisionNumber = existingRevisionCount + 1;

        const inTxNet = inTxDraft.totals.subtotalCents / 100;
        const inTxVat = inTxDraft.totals.taxAmountCents / 100;
        const inTxGross = inTxDraft.totals.totalCents / 100;

        const tokenHash = maskTokenForAudit(input.previewToken);

        // Complete Previous Provenance Record
        const previousProvenanceSnapshot = {
          invoiceNumber: invoice.invoiceNumber,
          date: invoice.date instanceof Date ? invoice.date.toISOString() : String(invoice.date),
          dueDate: invoice.dueDate
            ? invoice.dueDate instanceof Date
              ? invoice.dueDate.toISOString()
              : String(invoice.dueDate)
            : null,
          clientId: invoice.clientId,
          client: {
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
          hasStoredPdfFile: Boolean(invoice.pdfUrl || snap?.pdfUrl),
          pdfUrl: invoice.pdfUrl || snap?.pdfUrl || null,
          originReliability: originCheck.source,
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
            hasStoredPdfFile: Boolean(invoice.pdfUrl || snap?.pdfUrl),
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
            isSentRevised: isSent,
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
