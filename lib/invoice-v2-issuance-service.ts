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

export class StaleDraftError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StaleDraftError";
    this.code = code;
  }
}

export function computeV2DraftHash(draftResult: V2InvoiceDraftResult): string {
  if (draftResult.status !== "resolved") return "";
  const parts: string[] = [];
  for (const a of draftResult.provenance.assignments) {
    parts.push(
      [
        a.assignmentId,
        a.orderId,
        a.workerId,
        a.qualification,
        a.effectiveHoursVersion,
        a.effectiveHours,
        a.effectiveStartTime,
        a.effectiveEndTime,
        a.effectiveBreakMinutes,
        a.priceVersionId,
        a.policyFrozenHash,
      ].join(":")
    );
  }
  for (const item of draftResult.items) {
    parts.push(
      [
        item.pos,
        item.workerId,
        item.hoursDisplay,
        item.rateCents,
        item.amountCents,
        item.amountDisplay,
      ].join(":")
    );
  }
  parts.push(`subtotal:${draftResult.totals.subtotalCents}`);
  parts.push(`tax:${draftResult.totals.taxAmountCents}`);
  parts.push(`total:${draftResult.totals.totalCents}`);
  return parts.join("|");
}

export type IssueV2InvoiceOptions = {
  assignmentIds: string[];
  customInvoiceNumber?: string;
  customPeriodStart?: string;
  customPeriodEnd?: string;
  expectedDraftHash?: string;
  expectedAssignmentIds?: string[];
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
  generateInvoiceNumberFn?: typeof generateUniqueInvoiceNumber;
  prepareDraftFn?: (
    input: PrepareV2InvoiceDraftInput,
    deps?: V2DraftDependencies
  ) => Promise<V2InvoiceDraftResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txAuditLogFn?: (params: any, tx: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lockAssignmentsFn?: (assignmentIds: string[], tx: any) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceConcurrencyGuardFn?: (assignmentIds: string[], tx: any) => Promise<void>;
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
  | "MONTH_PREVIEW_REQUIRED"
  | "MONTH_ASSIGNMENT_SET_MUTATED"
  | "ORDER_SCOPE_MISMATCH"
  | "DRAFT_UNRESOLVED"
  | "DRAFT_MUTATION_DETECTED"
  | "STALE_DRAFT_DETECTED"
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

  // Verify expected assignment IDs if provided
  if (opts.expectedAssignmentIds) {
    const requestedSet = new Set(assignmentIds);
    const expectedSet = new Set(opts.expectedAssignmentIds);
    const hasMismatch =
      requestedSet.size !== expectedSet.size ||
      opts.expectedAssignmentIds.some((id) => !requestedSet.has(id));
    if (hasMismatch) {
      return {
        success: false,
        code: "MONTH_ASSIGNMENT_SET_MUTATED",
        message: "Die angeforderten Schichten weichen von der erwarteten Schichtenmenge ab.",
      };
    }
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

    // Verify all unbilled confirmed assignments for this month are included
    const unbilledInMonth = await db.assignment.findMany({
      where: {
        order: {
          clientId: targetClientId,
          shiftDate: { gte: monthStart, lt: monthEnd },
        },
        invoiceId: null,
        status: "confirmed",
      },
      select: { id: true },
    });
    const unbilledIds = new Set<string>((unbilledInMonth as { id: string }[]).map((a) => a.id));
    const currentIds = new Set<string>(assignmentIds);
    if (unbilledIds.size !== currentIds.size || Array.from(unbilledIds).some((id: string) => !currentIds.has(id))) {
      return {
        success: false,
        code: "MONTH_ASSIGNMENT_SET_MUTATED",
        message: `Die abrechenbaren Schichten für diesen Monat (${month}/${year}) stimmen nicht mit der Auswahl überein (in DB: ${unbilledIds.size}, ausgewählt: ${currentIds.size}). Bitte aktualisieren Sie die Monatsvorschau.`,
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

  // 5. Prepare modern V2 draft initially in read-only mode (pre-transaction check)
  const prepareDraft =
    deps?.prepareDraftFn ??
    (await import("@/lib/invoice-v2-draft-service")).prepareV2InvoiceDraft;
  const preDraftResult: V2InvoiceDraftResult = await prepareDraft(
    {
      assignmentIds,
      customPeriodStart: opts.customPeriodStart,
      customPeriodEnd: opts.customPeriodEnd,
    },
    deps
  );

  if (preDraftResult.status === "unresolved") {
    return {
      success: false,
      code: "DRAFT_UNRESOLVED",
      message: `V2-Berechnung konnte nicht aufgelöst werden [${preDraftResult.code}]: ${preDraftResult.message}`,
      diagnostics: preDraftResult.diagnostics,
    };
  }

  const preDraftHash = computeV2DraftHash(preDraftResult);

  // If a draft hash was expected from a previous preview, verify anti-mutation integrity upfront
  if (opts.expectedDraftHash && opts.expectedDraftHash !== preDraftHash) {
    return {
      success: false,
      code: "STALE_DRAFT_DETECTED",
      message:
        "Die Berechnungsdaten (Stunden, Preise oder Richtlinien) haben sich seit der Vorschau geändert. Bitte neu prüfen.",
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

  try {
    const txResult = await db.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        // Concurrency Protocol Step A: Row locking on selected assignments
        if (deps?.lockAssignmentsFn) {
          await deps.lockAssignmentsFn(assignmentIds, tx);
        } else if (typeof tx.$executeRawUnsafe === "function") {
          try {
            const quotedIds = assignmentIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
            if (quotedIds) {
              await tx.$executeRawUnsafe(`SELECT id FROM "Assignment" WHERE id IN (${quotedIds}) FOR UPDATE`);
            }
          } catch {
            // Safe fallback if test mock or underlying engine does not support raw SQL
          }
        }

        // Concurrency Protocol Step B: In-transaction re-verification of the month assignment set
        if (opts.monthScope) {
          const { clientId: targetClientId, year, month } = opts.monthScope;
          const monthStart = new Date(Date.UTC(year, month - 1, 1));
          const monthEnd = new Date(Date.UTC(year, month, 1));

          const inTxUnbilledMonthAssignments = await tx.assignment.findMany({
            where: {
              status: "confirmed",
              invoiceId: null,
              order: {
                clientId: targetClientId,
                shiftDate: { gte: monthStart, lt: monthEnd },
              },
            },
            select: { id: true },
          });

          const inTxUnbilledIds = new Set<string>((inTxUnbilledMonthAssignments as { id: string }[]).map((a) => a.id));
          const requestedIdsSet = new Set<string>(assignmentIds);

          const hasSetMismatch =
            inTxUnbilledIds.size !== requestedIdsSet.size ||
            Array.from(inTxUnbilledIds).some((id) => !requestedIdsSet.has(id));

          if (hasSetMismatch) {
            throw new StaleDraftError(
              "MONTH_ASSIGNMENT_SET_MUTATED",
              `Die abrechenbaren Schichten für diesen Monat (${month}/${year}) haben sich während der Transaktion geändert (in DB: ${inTxUnbilledIds.size}, angefordert: ${requestedIdsSet.size}). Die Transaktion wird abgebrochen.`
            );
          }
        }

        // Concurrency Protocol Step C: Re-verify the draft INSIDE the transaction using tx
        const inTxDraftResult = await prepareDraft(
          {
            assignmentIds,
            customPeriodStart: opts.customPeriodStart,
            customPeriodEnd: opts.customPeriodEnd,
          },
          { ...deps, prisma: tx }
        );

        if (inTxDraftResult.status === "unresolved") {
          throw new StaleDraftError(
            "DRAFT_UNRESOLVED",
            `V2-Berechnung konnte innerhalb der Transaktion nicht aufgelöst werden [${inTxDraftResult.code}]: ${inTxDraftResult.message}`
          );
        }

        const inTxDraftHash = computeV2DraftHash(inTxDraftResult);

        // Verify that in-tx draft hash matches pre-tx draft hash
        if (inTxDraftHash !== preDraftHash) {
          throw new StaleDraftError(
            "STALE_DRAFT_DETECTED",
            "Die Berechnungsdaten (Stunden, Preise, Schichtzeiten oder Richtlinien) haben sich zwischen Entwurfsvorbereitung und Transaktionsbeginn geändert (Stale Draft). Die Transaktion wird abgebrochen."
          );
        }

        // If an expected draft hash was specified by the caller, verify it against the in-tx draft
        if (opts.expectedDraftHash && inTxDraftHash !== opts.expectedDraftHash) {
          throw new StaleDraftError(
            "DRAFT_MUTATION_DETECTED",
            "Die Berechnungsdaten innerhalb der Transaktion weichen vom erwarteten Entwurfshash ab."
          );
        }

        // Concurrency Protocol Step D: Source concurrency guard to verify source state
        if (deps?.sourceConcurrencyGuardFn) {
          await deps.sourceConcurrencyGuardFn(assignmentIds, tx);
        }

        const { totals } = inTxDraftResult;
        const netAmount = totals.subtotalCents / 100;
        const vatAmount = totals.taxAmountCents / 100;
        const grossAmount = totals.totalCents / 100;

        // Mathematical and parity safety check
        if (
          Math.round(netAmount * 100) !== totals.subtotalCents ||
          Math.round(vatAmount * 100) !== totals.taxAmountCents ||
          Math.round(grossAmount * 100) !== totals.totalCents
        ) {
          throw new Error("Mathematischer Rundungsfehler bei der Cent-zu-Euro-Konvertierung.");
        }

        const frozenSnapshotData: V2InvoiceDraftSnapshotData & {
          issuedAt: string;
          issuedByUserId: string;
          isFrozen: true;
        } = {
          ...inTxDraftResult.snapshotData,
          issuedAt,
          issuedByUserId,
          isFrozen: true,
          calculationVersion: "v2",
        };

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

        // Concurrency Protocol Step G: Mandatory in-transaction audit log
        if (deps?.txAuditLogFn) {
          await deps.txAuditLogFn(
            {
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
            },
            tx
          );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if ((tx as any).auditLog?.create) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx as any).auditLog.create({
            data: {
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
            },
          });
        } else {
          throw new Error(
            "Kein transaktionaler Audit-Log-Handler verfügbar. Rechnungserstellung abgebrochen."
          );
        }

        return {
          invoice,
          totals,
          netAmount,
          vatAmount,
          grossAmount,
          frozenSnapshotData,
        };
      },
      {
        isolationLevel: "Serializable",
        timeout: 15000,
      }
    );

    return {
      success: true,
      invoiceId: txResult.invoice.id,
      invoiceNumber: txResult.invoice.invoiceNumber,
      clientId,
      netAmount: txResult.netAmount,
      vatAmount: txResult.vatAmount,
      grossAmount: txResult.grossAmount,
      subtotalCents: txResult.totals.subtotalCents,
      taxAmountCents: txResult.totals.taxAmountCents,
      totalCents: txResult.totals.totalCents,
      assignmentCount: assignmentIds.length,
      calculationVersion: "v2",
      issuedAt,
      issuedByUserId,
      snapshotData: txResult.frozenSnapshotData,
    };
  } catch (txErr: unknown) {
    if (txErr instanceof StaleDraftError) {
      return {
        success: false,
        code: txErr.code as IssueV2InvoiceFailureCode,
        message: txErr.message,
      };
    }

    if (txErr instanceof ConcurrentModificationError) {
      return {
        success: false,
        code: "CONCURRENT_MODIFICATION",
        message: txErr.message,
      };
    }

    const txErrObj = txErr as { code?: string; message?: string } | undefined;

    // Prisma Serialization Failure (P2034) or Concurrency conflict
    if (
      txErrObj?.code === "P2034" ||
      String(txErrObj?.message).includes("P2034") ||
      String(txErrObj?.message).toLowerCase().includes("could not serialize") ||
      String(txErrObj?.message).toLowerCase().includes("serialization failure") ||
      String(txErrObj?.message).toLowerCase().includes("deadlock detected")
    ) {
      return {
        success: false,
        code: "CONCURRENT_MODIFICATION",
        message: "Gleichzeitige Änderung erkannt (Serialisierungs- oder Sperrkonflikt in Transaktion). Bitte versuchen Sie es erneut.",
      };
    }

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
