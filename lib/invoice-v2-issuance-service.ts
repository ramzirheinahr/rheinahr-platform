/**
 * Modern V2 Invoice Issuance Service (Phase 5b-2b)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Guarantees & Constraints:
 * 1. Single-Engine Issuance Gateway:
 *    Executes prepareV2InvoiceDraft and freezes the single-engine result in snapshotData
 *    with calculationVersion: "v2".
 * 2. Server-Derived Administrator Identity:
 *    Derives issuing administrator strictly from server session (requireRole).
 *    Never accepts client-supplied actorUserId or trusted draft hashes from the browser.
 * 3. Server Feature Flag (Disabled by Default):
 *    Controlled by process.env.FEATURE_INVOICE_V2_ISSUANCE === "true".
 *    When disabled, server routes either reject or fall back to legacy paths.
 *    When enabled, ambiguity or failure halts the batch immediately; NEVER falls back
 *    to requestNetTotal or Client.hourlyRates.
 * 4. Strict Input Preconditions & Zero Partial Invoicing:
 *    Requires non-empty, non-duplicate assignment IDs.
 *    Verifies every assignment exists, is confirmed, is unbilled (invoiceId === null),
 *    belongs to a single client, and matches the intended month/order scope.
 * 5. Atomic Issuance & Concurrency Protection:
 *    Executes Invoice creation and conditional Assignment linking (WHERE invoiceId IS NULL
 *    AND status = 'confirmed') in a single ACID transaction. If updatedCount !== expectedCount,
 *    immediately rolls back.
 * 6. Mathematical Parity & Safe Cents Conversion:
 *    Invoice.netAmount/vatAmount/grossAmount are derived from exact integer cents / 100 once.
 *    Subtotal equals sum of line items in cents.
 *    Tax equals exact ratio rounded to nearest cent.
 *    Gross equals subtotal + tax.
 * 7. Post-Commit Dispatch Isolation:
 *    Emails and notifications are triggered strictly after the database transaction commits.
 */

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateUniqueInvoiceNumber } from "@/lib/invoicing";
import type {
  PrepareV2InvoiceDraftInput,
  V2DraftDependencies,
  V2InvoiceDraftResult,
  V2InvoiceDraftSnapshotData,
} from "@/lib/invoice-v2-draft-service";

// Server Feature Flag (Disabled by default)
let v2IssuanceEnabledOverride: boolean | null = null;

export function isV2InvoiceIssuanceEnabled(): boolean {
  if (v2IssuanceEnabledOverride !== null) {
    return v2IssuanceEnabledOverride;
  }
  return process.env.FEATURE_INVOICE_V2_ISSUANCE === "true";
}

export function setV2InvoiceIssuanceOverrideForTesting(enabled: boolean | null): void {
  v2IssuanceEnabledOverride = enabled;
}

export class ConcurrentModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

export type IssueV2InvoiceOptions = {
  assignmentIds: string[];
  customInvoiceNumber?: string;
  customPeriodStart?: string;
  customPeriodEnd?: string;
  expectedDraftHash?: string;
  monthScope?: {
    clientId: string;
    year: number;
    month: number;
  };
  orderScope?: {
    orderId?: string;
    requestGroupId?: string;
  };
};

export type V2IssuanceDependencies = V2DraftDependencies & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any;
  requireRoleFn?: typeof requireRole;
  auditFn?: typeof audit;
  generateInvoiceNumberFn?: typeof generateUniqueInvoiceNumber;
  prepareDraftFn?: (
    input: PrepareV2InvoiceDraftInput,
    deps?: V2DraftDependencies
  ) => Promise<V2InvoiceDraftResult>;
};

export type IssueV2InvoiceSuccess = {
  success: true;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  assignmentCount: number;
  calculationVersion: "v2";
  issuedAt: string;
  issuedByUserId: string;
  snapshotData: V2InvoiceDraftSnapshotData & {
    issuedAt: string;
    issuedByUserId: string;
    isFrozen: true;
  };
};

export type IssueV2InvoiceFailureCode =
  | "V2_ISSUANCE_DISABLED"
  | "UNAUTHORIZED"
  | "NO_ASSIGNMENTS_SELECTED"
  | "DUPLICATE_ASSIGNMENT_IDS"
  | "ASSIGNMENT_NOT_FOUND"
  | "ASSIGNMENT_NOT_CONFIRMED"
  | "ALREADY_BILLED"
  | "MIXED_CLIENTS"
  | "MONTH_SCOPE_MISMATCH"
  | "ORDER_SCOPE_MISMATCH"
  | "DRAFT_UNRESOLVED"
  | "DRAFT_MUTATION_DETECTED"
  | "CONCURRENT_MODIFICATION"
  | "INVOICE_NUMBER_CONFLICT"
  | "TRANSACTION_FAILED";

export type IssueV2InvoiceFailure = {
  success: false;
  code: IssueV2InvoiceFailureCode;
  message: string;
  diagnostics?: Record<string, unknown>;
};

export type IssueV2InvoiceResult = IssueV2InvoiceSuccess | IssueV2InvoiceFailure;

/**
 * Issues a modern V2 invoice atomically from a prepared V2 calculation draft.
 */
export async function issueV2Invoice(
  opts: IssueV2InvoiceOptions,
  deps: V2IssuanceDependencies = {}
): Promise<IssueV2InvoiceResult> {
  const db = deps.prisma ?? prisma;
  const roleChecker = deps.requireRoleFn ?? requireRole;
  const auditLogger = deps.auditFn ?? audit;
  const numGenerator = deps.generateInvoiceNumberFn ?? generateUniqueInvoiceNumber;

  // 1. Check feature flag
  if (!isV2InvoiceIssuanceEnabled()) {
    return {
      success: false,
      code: "V2_ISSUANCE_DISABLED",
      message:
        "Die V2-Rechnungserstellung ist serverseitig deaktiviert (FEATURE_INVOICE_V2_ISSUANCE ist nicht aktiv).",
    };
  }

  // 2. Pre-validate assignment IDs input
  const { assignmentIds } = opts;
  if (!assignmentIds || !Array.isArray(assignmentIds) || assignmentIds.length === 0) {
    return {
      success: false,
      code: "NO_ASSIGNMENTS_SELECTED",
      message: "Keine Schichten für die Rechnungserstellung ausgewählt.",
    };
  }

  const uniqueIds = Array.from(new Set(assignmentIds));
  if (uniqueIds.length !== assignmentIds.length) {
    return {
      success: false,
      code: "DUPLICATE_ASSIGNMENT_IDS",
      message: "Die Liste der ausgewählten Schichten enthält doppelte Kennungen.",
      diagnostics: {
        totalRequested: assignmentIds.length,
        uniqueCount: uniqueIds.length,
      },
    };
  }

  // 3. Derive administrator identity strictly on server
  let issuedByUserId: string;
  try {
    const user = await roleChecker("de", "admin");
    issuedByUserId = user.id;
  } catch (authErr: unknown) {
    const msg = authErr instanceof Error ? authErr.message : "Fehlende Administratorberechtigung für die Rechnungserstellung.";
    return {
      success: false,
      code: "UNAUTHORIZED",
      message: msg,
    };
  }

  type RetrievedAssignment = {
    id: string;
    status: string;
    invoiceId: string | null;
    orderId: string;
    order: {
      clientId: string;
      requestGroupId: string | null;
      shiftDate: Date | string;
      client: {
        id: string;
        userId: string;
        shortCode: string | null;
        internalNumber: string | null;
        facilityName: string | null;
        billingEmail: string | null;
        billingInfo: string | null;
      };
    };
    worker: {
      id: string;
      fullName: string;
    };
  };

  // 4. Query assignments from database to verify preconditions before any write
  const rawAssignments = await db.assignment.findMany({
    where: { id: { in: assignmentIds } },
    include: {
      order: {
        include: { client: true },
      },
      worker: true,
    },
    orderBy: { order: { shiftDate: "asc" } },
  });
  const assignments = rawAssignments as RetrievedAssignment[];

  if (assignments.length !== assignmentIds.length) {
    const foundIds = new Set(assignments.map((a) => a.id));
    const missingIds = assignmentIds.filter((id) => !foundIds.has(id));
    return {
      success: false,
      code: "ASSIGNMENT_NOT_FOUND",
      message: `Mindestens eine der angeforderten Schichten existiert nicht in der Datenbank (fehlend: ${missingIds.length}).`,
      diagnostics: { missingAssignmentIds: missingIds },
    };
  }

  // Verify status is confirmed
  const unconfirmed = assignments.filter((a) => a.status !== "confirmed");
  if (unconfirmed.length > 0) {
    return {
      success: false,
      code: "ASSIGNMENT_NOT_CONFIRMED",
      message: `Mindestens eine Schicht ist nicht im Status "confirmed" (nicht bestätigt: ${unconfirmed.length}).`,
      diagnostics: { unconfirmedAssignmentIds: unconfirmed.map((a) => a.id) },
    };
  }

  // Verify not already invoiced
  const alreadyInvoiced = assignments.filter((a) => a.invoiceId !== null);
  if (alreadyInvoiced.length > 0) {
    return {
      success: false,
      code: "ALREADY_BILLED",
      message: `Mindestens eine Schicht ist bereits mit einer Rechnung verknüpft (bereits abgerechnet: ${alreadyInvoiced.length}).`,
      diagnostics: { alreadyBilledAssignmentIds: alreadyInvoiced.map((a) => a.id) },
    };
  }

  // Verify all belong to the same client
  const client = assignments[0].order.client;
  const clientId = client.id;
  const mixedClientAssignments = assignments.filter((a) => a.order.clientId !== clientId);
  if (mixedClientAssignments.length > 0) {
    return {
      success: false,
      code: "MIXED_CLIENTS",
      message: "Alle ausgewählten Schichten müssen zur selben Einrichtung (Kunde) gehören.",
      diagnostics: {
        expectedClientId: clientId,
        deviatingCount: mixedClientAssignments.length,
      },
    };
  }

  // Verify month scope if provided
  if (opts.monthScope) {
    const { clientId: targetClientId, year, month } = opts.monthScope;
    if (targetClientId !== clientId) {
      return {
        success: false,
        code: "MONTH_SCOPE_MISMATCH",
        message: `Die Einrichtungs-ID der Schichten (${clientId}) stimmt nicht mit dem Monatsbereich überein (${targetClientId}).`,
      };
    }
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 1));

    const outOfRange = assignments.filter((a) => {
      const d = a.order.shiftDate instanceof Date ? a.order.shiftDate : new Date(a.order.shiftDate);
      return d < monthStart || d >= monthEnd;
    });
    if (outOfRange.length > 0) {
      return {
        success: false,
        code: "MONTH_SCOPE_MISMATCH",
        message: `Mindestens eine Schicht liegt außerhalb des gewählten Monatszeitraums (${month}/${year}).`,
        diagnostics: { outOfRangeCount: outOfRange.length },
      };
    }
  }

  // Verify order scope if provided
  if (opts.orderScope) {
    if (opts.orderScope.orderId) {
      const deviatingOrder = assignments.filter((a) => a.orderId !== opts.orderScope?.orderId);
      if (deviatingOrder.length > 0) {
        return {
          success: false,
          code: "ORDER_SCOPE_MISMATCH",
          message: "Nicht alle Schichten gehören zum angegebenen Auftrag.",
        };
      }
    }
    if (opts.orderScope.requestGroupId) {
      const deviatingGroup = assignments.filter(
        (a) => a.order.requestGroupId !== opts.orderScope?.requestGroupId
      );
      if (deviatingGroup.length > 0) {
        return {
          success: false,
          code: "ORDER_SCOPE_MISMATCH",
          message: "Nicht alle Schichten gehören zur angegebenen Auftragsserie (Request Group).",
        };
      }
    }
  }

  // 5. Prepare modern V2 draft purely in read-only mode
  const prepareDraft =
    deps?.prepareDraftFn ??
    (await import("@/lib/invoice-v2-draft-service")).prepareV2InvoiceDraft;
  const draftResult: V2InvoiceDraftResult = await prepareDraft(
    {
      assignmentIds,
      customPeriodStart: opts.customPeriodStart,
      customPeriodEnd: opts.customPeriodEnd,
    },
    deps
  );

  if (draftResult.status === "unresolved") {
    return {
      success: false,
      code: "DRAFT_UNRESOLVED",
      message: `V2-Berechnung konnte nicht aufgelöst werden [${draftResult.code}]: ${draftResult.message}`,
      diagnostics: draftResult.diagnostics,
    };
  }

  // If a draft hash was expected from a previous preview, verify anti-mutation integrity
  if (opts.expectedDraftHash) {
    // Generate simple deterministic representation or compare directly
    const computedHash = draftResult.provenance.assignments
      .map((a) => `${a.assignmentId}:${a.effectiveHoursVersion}:${a.priceVersionId}:${a.policyFrozenHash}`)
      .join("|");
    if (computedHash !== opts.expectedDraftHash) {
      return {
        success: false,
        code: "DRAFT_MUTATION_DETECTED",
        message:
          "Die Berechnungsdaten (Stunden, Preise oder Richtlinien) haben sich seit der Vorschau geändert. Bitte neu prüfen.",
      };
    }
  }

  // 6. Compute exact invoice numbers and amounts
  const { totals } = draftResult;
  const netAmount = totals.subtotalCents / 100;
  const vatAmount = totals.taxAmountCents / 100;
  const grossAmount = totals.totalCents / 100;

  // Mathematical and parity safety check
  if (
    Math.round(netAmount * 100) !== totals.subtotalCents ||
    Math.round(vatAmount * 100) !== totals.taxAmountCents ||
    Math.round(grossAmount * 100) !== totals.totalCents
  ) {
    return {
      success: false,
      code: "TRANSACTION_FAILED",
      message: "Mathematischer Rundungsfehler bei der Cent-zu-Euro-Konvertierung.",
    };
  }

  const firstDate = assignments[0].order.shiftDate instanceof Date
    ? assignments[0].order.shiftDate
    : new Date(assignments[0].order.shiftDate);
  const identifier = client.internalNumber || client.shortCode || client.id.substring(0, 4).toUpperCase();

  let invoiceNumber: string;
  try {
    invoiceNumber = await numGenerator({
      identifier,
      date: firstDate,
      customInvoiceNumber: opts.customInvoiceNumber,
    });
  } catch (numErr: unknown) {
    const msg = numErr instanceof Error ? numErr.message : "Fehler bei der Generierung der Rechnungsnummer.";
    return {
      success: false,
      code: "INVOICE_NUMBER_CONFLICT",
      message: msg,
    };
  }

  const issuedAt = new Date().toISOString();
  const frozenSnapshotData: V2InvoiceDraftSnapshotData & {
    issuedAt: string;
    issuedByUserId: string;
    isFrozen: true;
  } = {
    ...draftResult.snapshotData,
    issuedAt,
    issuedByUserId,
    isFrozen: true,
    calculationVersion: "v2",
  };

  // 7. Execute atomic database transaction
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createdInvoice = await db.$transaction(async (tx: any) => {
      // Create Invoice
      const invoice = await tx.invoice.create({
        data: {
          clientId,
          invoiceNumber,
          netAmount,
          vatAmount,
          grossAmount,
          status: "unpaid",
          date: new Date(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          snapshotData: frozenSnapshotData as any,
        },
      });

      // Atomically link all assignments conditioned on invoiceId: null and status: confirmed
      const linkResult = await tx.assignment.updateMany({
        where: {
          id: { in: assignmentIds },
          invoiceId: null,
          status: "confirmed",
        },
        data: {
          invoiceId: invoice.id,
        },
      });

      if (linkResult.count !== assignmentIds.length) {
        throw new ConcurrentModificationError(
          `Gleichzeitige Änderung erkannt: ${assignmentIds.length} Schichten erwartet, aber nur ${linkResult.count} verknüpft.`
        );
      }

      // Record audit within transaction
      await auditLogger({
        userId: issuedByUserId,
        action: "invoice.generate_v2",
        entity: "Invoice",
        entityId: invoice.id,
        metadata: {
          calculationVersion: "v2",
          assignmentCount: assignmentIds.length,
          netAmount,
          vatAmount,
          grossAmount,
          subtotalCents: totals.subtotalCents,
          taxAmountCents: totals.taxAmountCents,
          totalCents: totals.totalCents,
        },
      });

      return invoice;
    });

    return {
      success: true,
      invoiceId: createdInvoice.id,
      invoiceNumber: createdInvoice.invoiceNumber,
      clientId,
      netAmount,
      vatAmount,
      grossAmount,
      subtotalCents: totals.subtotalCents,
      taxAmountCents: totals.taxAmountCents,
      totalCents: totals.totalCents,
      assignmentCount: assignmentIds.length,
      calculationVersion: "v2",
      issuedAt,
      issuedByUserId,
      snapshotData: frozenSnapshotData,
    };
  } catch (txErr: unknown) {
    if (txErr instanceof ConcurrentModificationError) {
      return {
        success: false,
        code: "CONCURRENT_MODIFICATION",
        message: txErr.message,
      };
    }

    const txErrObj = txErr as { code?: string; message?: string } | undefined;

    // Prisma Unique Constraint Violation (P2002 on invoiceNumber)
    if (txErrObj?.code === "P2002" || String(txErrObj?.message).includes("Unique constraint failed")) {
      return {
        success: false,
        code: "INVOICE_NUMBER_CONFLICT",
        message: `Die Rechnungsnummer "${invoiceNumber}" steht im Konflikt mit einer bestehenden Rechnung.`,
      };
    }

    return {
      success: false,
      code: "TRANSACTION_FAILED",
      message: txErrObj?.message || "Unerwarteter Fehler bei der Transaktion zur Rechnungserstellung.",
    };
  }
}
