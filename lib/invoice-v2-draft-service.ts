/**
 * Modern V2 Invoice Preparation Service (Phase 5a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Principles & Architectural Guarantees:
 * 1. Strictly Read-Only Preparation:
 *    Generates an immutable, serializable draft model without writing to Database,
 *    without mutating Assignment rows, without creating Invoice rows, and without sending emails.
 * 2. Strict Input Preconditions & Non-Partial Invoicing:
 *    Requires that every requested assignment ID exists, is confirmed, is unbilled,
 *    belongs to the same client, and is unique. If even one assignment cannot be resolved,
 *    the entire draft fails with a typed error; partial drafts are strictly prohibited.
 * 3. Exact Provenance Integration:
 *    - Phase 3c: Reads effective work hours from approved corrections > confirmations > scheduled.
 *    - Phase 4a: Enforces frozen facility surcharge policies (returns error on unfrozen/tampered).
 *    - Phase 4b: Partitions minutes and applies statutory surcharge rules via `splitShiftMinutes`.
 * 4. Dated Verifiable Price Version Gateway:
 *    Requires a verifiable dated price record. If missing or unverifiable, returns PRICE_UNRESOLVED.
 *    Never fabricates priceVersionId from live client defaults or surcharge policies.
 * 5. Break Clause Contractual Authority Gateway:
 *    Proportional break allocation across surcharge categories requires verified, server-checked
 *    contractual authority matching client, contract, and policy version. Fabricated or loose
 *    text clauses are strictly rejected and return UNRESOLVED_BREAK_ALLOCATION.
 * 6. Single-Engine Exact Parity:
 *    Uses Phase 4b adapter (`convertPreparedItemsToRawInvoiceLines`) and Phase 2 engine
 *    (`calculateExactInvoice`). Produces identical items, totals, and snapshotData for DB,
 *    snapshot, and PDF in Phase 5b.
 */

import {
  calculateExactInvoice,
  type CalculatedLineItem,
  type CalculatedInvoiceTotals,
  type RawWorkLineInput,
  type TaxRateSpecification,
} from "./invoice-exact-engine";
import {
  splitShiftMinutes,
  convertPreparedItemsToRawInvoiceLines,
  type ShiftMinuteSplitterInput,
  type VerifiedContractBreakAllocationClause,
} from "./shift-minute-splitter";
import {
  resolveInvoiceSurchargePolicy,
  type ResolvedSurchargePolicy,
  type ResolvedSurchargePolicySuccess,
} from "./surcharge-policy";
import { getAssignmentEffectiveWorkHours } from "./confirmation-evidence-service";
import { prisma } from "./prisma";

export type PriceVersionRecord = {
  priceVersionId: string;
  clientId: string;
  qualification: string;
  hourlyRateInCents: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null; // YYYY-MM-DD
  contractId?: string | null;
  sourceReference: string;
  verifiedAt: string;
  verifiedBy: string;
};

export type PriceVersionResolver = (params: {
  clientId: string;
  qualification: string;
  shiftDateIso: string;
  contractId?: string | null;
}) => Promise<PriceVersionRecord | null> | PriceVersionRecord | null;

export type VerifiedBreakClauseResolver = (params: {
  clientId: string;
  clientContractId: string;
  policyVersion: number;
}) => Promise<VerifiedContractBreakAllocationClause | null> | VerifiedContractBreakAllocationClause | null;

export type FacilityPolicyResolver = (params: {
  clientId: string;
  shiftDateIso: string;
}) => Promise<ResolvedSurchargePolicy | null> | ResolvedSurchargePolicy | null;

export type EffectiveHoursResolver = (
  assignmentId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any
) => Promise<{
  assignmentId: string;
  effectiveHours: number;
  effectiveStartTime: string;
  effectiveEndTime: string;
  effectiveBreakMinutes: number;
  source: "approved_correction" | "service_confirmation" | "scheduled";
  effectiveVersion: string;
  isCorrected: boolean;
  approvedCorrection?: {
    id: string;
    revision?: number | null;
    [key: string]: unknown;
  } | null;
}>;

export type V2DraftDependencies = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma?: any;
  priceVersionResolver?: PriceVersionResolver;
  facilityPolicyResolver?: FacilityPolicyResolver;
  verifiedBreakClauseResolver?: VerifiedBreakClauseResolver;
  effectiveHoursResolver?: EffectiveHoursResolver;
};

export type PrepareV2InvoiceDraftInput = {
  assignmentIds: string[];
  taxRate?: TaxRateSpecification; // defaults to 19% VAT
  customPeriodStart?: string;     // optional override (YYYY-MM-DD)
  customPeriodEnd?: string;       // optional override (YYYY-MM-DD)
  allowedQualifications?: readonly string[] | Set<string>;
};

export type V2InvoiceDraftAssignmentProvenance = {
  assignmentId: string;
  orderId: string;
  workerId: string;
  workerName: string;
  qualification: string;
  shiftDate: string;
  effectiveHoursVersion: string;
  effectiveHoursSource: string;
  policyId: string;
  policyVersion: number;
  policyFrozenHash: string;
  priceVersionId: string;
  baseHourlyRateCents: number;
  netWorkMinutes: number;
  breakMinutes: number;
};

export type V2InvoiceDraftSnapshotData = {
  calculationVersion: "v2";
  facilityName: string;
  internalNumber?: string | null;
  shortCode?: string | null;
  address?: string | null;
  billingEmail?: string | null;
  billingInfo?: string | null;
  paymentTermsDays: number;
  periodStart: string;
  periodEnd: string;
  items: CalculatedLineItem[];
  subtotal: string;
  taxAmount: string;
  total: string;
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  taxRatePercent: number;
  totalLineItemMinutes: number;
  netWorkMinutes: number;
  isFrozen: true;
  preparedAt: string;
  pricingProvenance: {
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
};

export type V2InvoiceDraftSuccess = {
  status: "resolved";
  calculationVersion: "v2";
  clientId: string;
  clientInfo: {
    facilityName: string;
    internalNumber?: string | null;
    shortCode?: string | null;
    address?: string | null;
    billingEmail?: string | null;
    billingInfo?: string | null;
    paymentTermsDays: number;
  };
  periodStart: string;
  periodEnd: string;
  periodDisplay: string;
  assignmentIds: string[];
  shiftCount: number;

  provenance: {
    assignments: V2InvoiceDraftAssignmentProvenance[];
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

  items: CalculatedLineItem[];
  totals: CalculatedInvoiceTotals;
  snapshotData: V2InvoiceDraftSnapshotData;
};

export type V2InvoiceDraftUnresolvedCode =
  | "NO_ASSIGNMENTS_SELECTED"
  | "DUPLICATE_ASSIGNMENT_IDS"
  | "ASSIGNMENT_NOT_FOUND"
  | "ASSIGNMENT_NOT_CONFIRMED"
  | "ALREADY_BILLED"
  | "MIXED_CLIENTS"
  | "PRICE_UNRESOLVED"
  | "UNVERIFIED_BREAK_CLAUSE"
  | "UNRESOLVED_BREAK_ALLOCATION"
  | "POLICY_UNRESOLVED"
  | "POLICY_NOT_FROZEN"
  | "EFFECTIVE_HOURS_MISMATCH"
  | "INVALID_EFFECTIVE_HOURS"
  | "DST_GAP"
  | "DST_AMBIGUOUS"
  | "CALCULATION_ERROR"
  | string;

export type V2InvoiceDraftUnresolved = {
  status: "unresolved";
  code: V2InvoiceDraftUnresolvedCode;
  message: string;
  diagnostics: {
    assignmentId?: string;
    workerId?: string;
    clientId?: string;
    shiftDate?: string;
    [key: string]: unknown;
  };
};

export type V2InvoiceDraftResult =
  | V2InvoiceDraftSuccess
  | V2InvoiceDraftUnresolved;

/**
 * Format ISO YYYY-MM-DD date to German DD.MM.YYYY string
 */
function formatIsoToGerman(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }
  return isoDate;
}

/**
 * Prepares a modern V2 invoice draft purely in read-only mode.
 * Guarantees zero writes to the database, zero mutations, and zero email dispatch.
 */
export async function prepareV2InvoiceDraft(
  input: PrepareV2InvoiceDraftInput,
  deps?: V2DraftDependencies
): Promise<V2InvoiceDraftResult> {
  // 1. Sanity Check on Input Assignment IDs
  if (!input.assignmentIds || !Array.isArray(input.assignmentIds) || input.assignmentIds.length === 0) {
    return {
      status: "unresolved",
      code: "NO_ASSIGNMENTS_SELECTED",
      message: "Keine Schichten für die Rechnungsvorbereitung ausgewählt.",
      diagnostics: {},
    };
  }

  // 2. Reject Duplicate Assignment IDs Upfront
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  for (const id of input.assignmentIds) {
    if (seenIds.has(id)) {
      duplicateIds.push(id);
    } else {
      seenIds.add(id);
    }
  }
  if (duplicateIds.length > 0) {
    return {
      status: "unresolved",
      code: "DUPLICATE_ASSIGNMENT_IDS",
      message: `Doppelte Schicht-IDs in der Anfrage gefunden: ${duplicateIds.join(", ")}.`,
      diagnostics: { duplicateIds },
    };
  }

  // 3. Read Assignments from Database (Read-Only)
  const tx = deps?.prisma || prisma;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawAssignments: any[];
  try {
    rawAssignments = await tx.assignment.findMany({
      where: { id: { in: input.assignmentIds } },
      include: {
        order: {
          include: { client: true },
        },
        worker: true,
        serviceConfirmation: true,
        clientContract: true,
      },
    });
  } catch (err) {
    return {
      status: "unresolved",
      code: "DATABASE_READ_ERROR",
      message: `Fehler beim Lesen der Schichten aus der Datenbank: ${err instanceof Error ? err.message : String(err)}`,
      diagnostics: { details: err },
    };
  }

  // Check that every requested ID exists
  const foundMap = new Map(rawAssignments.map((a) => [a.id, a]));
  const missingIds = input.assignmentIds.filter((id) => !foundMap.has(id));
  if (missingIds.length > 0) {
    return {
      status: "unresolved",
      code: "ASSIGNMENT_NOT_FOUND",
      message: `Die folgenden angeforderten Schichten wurden nicht in der Datenbank gefunden: ${missingIds.join(", ")}.`,
      diagnostics: { missingAssignmentIds: missingIds },
    };
  }

  // Check that every assignment is confirmed
  const unconfirmed = rawAssignments.filter((a) => a.status !== "confirmed");
  if (unconfirmed.length > 0) {
    const first = unconfirmed[0];
    return {
      status: "unresolved",
      code: "ASSIGNMENT_NOT_CONFIRMED",
      message: `Schicht "${first.id}" hat den Status "${first.status}" und ist nicht bestätigt. Nur bestätigte Schichten können abgerechnet werden.`,
      diagnostics: {
        assignmentId: first.id,
        workerId: first.workerId,
        status: first.status,
        unconfirmedAssignmentIds: unconfirmed.map((a) => a.id),
      },
    };
  }

  // Check that no assignment is already billed
  const alreadyBilled = rawAssignments.filter((a) => a.invoiceId !== null);
  if (alreadyBilled.length > 0) {
    const first = alreadyBilled[0];
    return {
      status: "unresolved",
      code: "ALREADY_BILLED",
      message: `Schicht "${first.id}" ist bereits der Rechnung "${first.invoiceId}" zugewiesen. Eine doppelte Abrechnung ist unzulässig.`,
      diagnostics: {
        assignmentId: first.id,
        workerId: first.workerId,
        invoiceId: first.invoiceId,
        alreadyBilledAssignmentIds: alreadyBilled.map((a) => a.id),
      },
    };
  }

  // Check that all assignments belong to the same client
  const clientIds = Array.from(new Set(rawAssignments.map((a) => a.order.clientId)));
  if (clientIds.length > 1) {
    return {
      status: "unresolved",
      code: "MIXED_CLIENTS",
      message: `Ausgewählte Schichten gehören zu unterschiedlichen Kunden (${clientIds.join(", ")}). Eine Rechnung kann nur für einen einzigen Kunden vorbereitet werden.`,
      diagnostics: { clientIds },
    };
  }

  // 4. Deterministic Sorting of Assignments
  // shiftDate ASC, startTime ASC, workerId ASC, assignmentId ASC
  const assignments = [...rawAssignments].sort((a, b) => {
    const aDate = a.order.shiftDate instanceof Date ? a.order.shiftDate.getTime() : new Date(a.order.shiftDate).getTime();
    const bDate = b.order.shiftDate instanceof Date ? b.order.shiftDate.getTime() : new Date(b.order.shiftDate).getTime();
    if (aDate !== bDate) return aDate - bDate;

    const timeComp = String(a.order.startTime).localeCompare(String(b.order.startTime));
    if (timeComp !== 0) return timeComp;

    const workerComp = String(a.worker.id).localeCompare(String(b.worker.id));
    if (workerComp !== 0) return workerComp;

    return String(a.id).localeCompare(String(b.id));
  });

  const clientId = clientIds[0];
  const client = assignments[0].order.client;

  // 5. Process Each Assignment Sequentially & Deterministically
  const allRawLines: RawWorkLineInput[] = [];
  const assignmentProvenance: V2InvoiceDraftAssignmentProvenance[] = [];
  const policyVersionsMap = new Map<string, { policyId: string; policyVersion: number; frozenHash: string }>();
  const priceVersionsMap = new Map<string, { priceVersionId: string; qualification: string; hourlyRateInCents: number; sourceReference: string }>();

  for (const assignment of assignments) {
    const shiftDateIso =
      assignment.order.shiftDate instanceof Date
        ? assignment.order.shiftDate.toISOString().slice(0, 10)
        : String(assignment.order.shiftDate).slice(0, 10);

    const qualification =
      assignment.order.requiredQualification ||
      assignment.worker.qualification ||
      "pflegefachkraft";

    // A. Phase 3c Effective Work Hours
    let effectiveHoursData: {
      effectiveHours: number;
      effectiveStartTime: string;
      effectiveEndTime: string;
      effectiveBreakMinutes: number;
      source: "approved_correction" | "service_confirmation" | "scheduled";
      effectiveVersion: string;
      isCorrected: boolean;
      approvedCorrection?: {
        id: string;
        revision?: number | null;
        [key: string]: unknown;
      } | null;
    };

    try {
      if (deps?.effectiveHoursResolver) {
        effectiveHoursData = await deps.effectiveHoursResolver(assignment.id, tx);
      } else {
        effectiveHoursData = await getAssignmentEffectiveWorkHours(assignment.id, tx);
      }
    } catch (err) {
      return {
        status: "unresolved",
        code: "INVALID_EFFECTIVE_HOURS",
        message: `Fehler beim Abrufen der effektiven Arbeitsstunden für Schicht "${assignment.id}": ${err instanceof Error ? err.message : String(err)}`,
        diagnostics: { assignmentId: assignment.id, details: err },
      };
    }

    // B. Phase 4a Surcharge Policy Resolution
    let resolvedPolicy: ResolvedSurchargePolicy | null = null;
    if (deps?.facilityPolicyResolver) {
      resolvedPolicy = await deps.facilityPolicyResolver({
        clientId,
        shiftDateIso,
      });
    } else {
      // Direct database resolution for frozen policy
      try {
        const policyRecord = await tx.facilitySurchargePolicy.findFirst({
          where: {
            clientId,
            effectiveFrom: { lte: new Date(shiftDateIso) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date(shiftDateIso) } },
            ],
            isFrozen: true,
          },
          orderBy: { policyVersion: "desc" },
        });

        if (policyRecord) {
          resolvedPolicy = resolveInvoiceSurchargePolicy({
            policy: policyRecord,
            referenceDate: shiftDateIso,
          });
        }
      } catch (err) {
        return {
          status: "unresolved",
          code: "POLICY_UNRESOLVED",
          message: `Datenbankfehler beim Auflösen der Zuschlagsrichtlinie für Schicht "${assignment.id}": ${err instanceof Error ? err.message : String(err)}`,
          diagnostics: { assignmentId: assignment.id, clientId, shiftDateIso, details: err },
        };
      }
    }

    if (!resolvedPolicy || resolvedPolicy.status !== "resolved") {
      return {
        status: "unresolved",
        code: resolvedPolicy ? resolvedPolicy.code : "POLICY_UNRESOLVED",
        message: `Schicht "${assignment.id}" (${assignment.worker.fullName}, ${shiftDateIso}) kann nicht abgerechnet werden: ${resolvedPolicy ? resolvedPolicy.message : "Keine dokumentierte Zuschlagsrichtlinie gefunden."}`,
        diagnostics: {
          assignmentId: assignment.id,
          workerId: assignment.worker.id,
          clientId,
          shiftDateIso,
          ...(resolvedPolicy?.diagnostics || {}),
        },
      };
    }

    const policySuccess = resolvedPolicy as ResolvedSurchargePolicySuccess;
    if (!policySuccess.isFrozen) {
      return {
        status: "unresolved",
        code: "POLICY_NOT_FROZEN",
        message: `Die Zuschlagsrichtlinie (Version ${policySuccess.policyVersion}) für Schicht "${assignment.id}" ist nicht dauerhaft eingefroren.`,
        diagnostics: {
          assignmentId: assignment.id,
          policyId: policySuccess.policyId,
          policyVersion: policySuccess.policyVersion,
        },
      };
    }

    // C. Verifiable Dated Price Version Resolution
    if (!deps?.priceVersionResolver) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Kein verifizierbarer Preisversions-Resolver bereitgestellt für Schicht "${assignment.id}". Das Verwenden unversionierter Live-Kundenpreise ist unzulässig.`,
        diagnostics: {
          assignmentId: assignment.id,
          clientId,
          qualification,
          shiftDateIso,
        },
      };
    }

    let priceRecord: PriceVersionRecord | null = null;
    try {
      priceRecord = await deps.priceVersionResolver({
        clientId,
        qualification,
        shiftDateIso,
        contractId: assignment.contractId,
      });
    } catch (err) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Fehler beim Auflösen der Preisversion für Schicht "${assignment.id}": ${err instanceof Error ? err.message : String(err)}`,
        diagnostics: { assignmentId: assignment.id, clientId, qualification, shiftDateIso, details: err },
      };
    }

    if (!priceRecord) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Keine gültige, datierte Preisversion für Kunde "${clientId}", Qualifikation "${qualification}" zum Datum "${shiftDateIso}" gefunden. Ein Fallback auf unversionierte Live-Kundenpreise ist unzulässig.`,
        diagnostics: {
          assignmentId: assignment.id,
          clientId,
          qualification,
          shiftDateIso,
          contractId: assignment.contractId,
        },
      };
    }

    // Validate price record fields
    if (
      !priceRecord.priceVersionId ||
      !priceRecord.priceVersionId.trim() ||
      !Number.isSafeInteger(priceRecord.hourlyRateInCents) ||
      priceRecord.hourlyRateInCents < 0 ||
      !priceRecord.sourceReference ||
      !priceRecord.sourceReference.trim()
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die aufgelöste Preisversion für Schicht "${assignment.id}" enthält unvollständige oder ungültige Preisdaten.`,
        diagnostics: {
          assignmentId: assignment.id,
          priceRecord,
        },
      };
    }

    // Check price date validity interval
    if (
      priceRecord.effectiveFrom > shiftDateIso ||
      (priceRecord.effectiveTo && priceRecord.effectiveTo < shiftDateIso)
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${priceRecord.priceVersionId}" ist zum Datum "${shiftDateIso}" nicht gültig (Gültigkeit: ${priceRecord.effectiveFrom} bis ${priceRecord.effectiveTo || "unbegrenzt"}).`,
        diagnostics: {
          assignmentId: assignment.id,
          shiftDateIso,
          effectiveFrom: priceRecord.effectiveFrom,
          effectiveTo: priceRecord.effectiveTo,
        },
      };
    }

    // D. Contractual Break Clause Gateway
    let verifiedBreakClause: VerifiedContractBreakAllocationClause | undefined = undefined;
    let contractualBreakAllocationRule: "proportional" | null = null;
    let breakAllocationSourceReference: string | undefined = undefined;

    if (deps?.verifiedBreakClauseResolver && assignment.contractId) {
      try {
        const candidateClause = await deps.verifiedBreakClauseResolver({
          clientId,
          clientContractId: assignment.contractId,
          policyVersion: policySuccess.policyVersion,
        });

        // Strict verification: must match clientId, contractId, policyVersion, and have valid fields
        if (
          candidateClause &&
          candidateClause.clientId === clientId &&
          candidateClause.clientContractId === assignment.contractId &&
          candidateClause.policyVersion === policySuccess.policyVersion &&
          candidateClause.rule === "proportional" &&
          typeof candidateClause.clauseReference === "string" &&
          candidateClause.clauseReference.trim().length > 0 &&
          typeof candidateClause.verifiedAt === "string" &&
          typeof candidateClause.verifiedBy === "string"
        ) {
          verifiedBreakClause = candidateClause;
          contractualBreakAllocationRule = "proportional";
          breakAllocationSourceReference = candidateClause.clauseReference;
        }
      } catch {
        // If resolver throws, leave unverified so engine fails safely
        verifiedBreakClause = undefined;
      }
    }

    // E. Phase 4b Minute Splitting
    const splitterInput: ShiftMinuteSplitterInput = {
      shiftId: assignment.id,
      assignmentId: assignment.id,
      orderId: assignment.order.id,
      workerId: assignment.worker.id,
      workerName: assignment.worker.fullName,
      clientId,
      facilityName: client.facilityName,
      qualification,
      shiftDate: shiftDateIso,
      startTime: effectiveHoursData.effectiveStartTime,
      endTime: effectiveHoursData.effectiveEndTime,
      breakMinutes: effectiveHoursData.effectiveBreakMinutes,
      contractualBreakAllocationRule,
      breakAllocationSourceReference,
      verifiedBreakClause,
      effectiveWorkHoursRef: {
        effectiveHours: effectiveHoursData.effectiveHours,
        effectiveVersion: effectiveHoursData.effectiveVersion,
        source: effectiveHoursData.source,
        isCorrected: effectiveHoursData.isCorrected,
        approvedCorrectionId: effectiveHoursData.approvedCorrection?.id,
        approvedCorrectionRevision: effectiveHoursData.approvedCorrection?.revision,
      },
      policy: policySuccess,
    };

    const splitResult = splitShiftMinutes(splitterInput);
    if (splitResult.status === "unresolved") {
      return {
        status: "unresolved",
        code: splitResult.code,
        message: `Schicht "${assignment.id}" (${assignment.worker.fullName}, ${shiftDateIso}) konnte nicht aufgeteilt werden: ${splitResult.message}`,
        diagnostics: {
          assignmentId: assignment.id,
          workerId: assignment.worker.id,
          clientId,
          shiftDateIso,
          ...splitResult.diagnostics,
        },
      };
    }

    // F. Transform Prepared Line Items to RawWorkLineInput
    const shiftLines = convertPreparedItemsToRawInvoiceLines({
      preparedItems: splitResult.preparedLineItems,
      priceVersionId: priceRecord.priceVersionId,
      baseHourlyRateInCents: priceRecord.hourlyRateInCents,
    });

    allRawLines.push(...shiftLines);

    // G. Record Provenance
    assignmentProvenance.push({
      assignmentId: assignment.id,
      orderId: assignment.order.id,
      workerId: assignment.worker.id,
      workerName: assignment.worker.fullName,
      qualification,
      shiftDate: shiftDateIso,
      effectiveHoursVersion: effectiveHoursData.effectiveVersion,
      effectiveHoursSource: effectiveHoursData.source,
      policyId: policySuccess.policyId,
      policyVersion: policySuccess.policyVersion,
      policyFrozenHash: policySuccess.frozenHash,
      priceVersionId: priceRecord.priceVersionId,
      baseHourlyRateCents: priceRecord.hourlyRateInCents,
      netWorkMinutes: splitResult.netWorkMinutes,
      breakMinutes: splitResult.breakMinutes,
    });

    policyVersionsMap.set(
      `${policySuccess.policyId}::${policySuccess.policyVersion}`,
      {
        policyId: policySuccess.policyId,
        policyVersion: policySuccess.policyVersion,
        frozenHash: policySuccess.frozenHash,
      }
    );

    priceVersionsMap.set(
      `${priceRecord.priceVersionId}::${priceRecord.qualification}`,
      {
        priceVersionId: priceRecord.priceVersionId,
        qualification: priceRecord.qualification,
        hourlyRateInCents: priceRecord.hourlyRateInCents,
        sourceReference: priceRecord.sourceReference,
      }
    );
  }

  // 6. Calculate Exact Invoice Totals (Phase 2 Exact Engine)
  let calculationResult: ReturnType<typeof calculateExactInvoice>;
  try {
    calculationResult = calculateExactInvoice(allRawLines, {
      taxRate: input.taxRate,
      allowedQualifications: input.allowedQualifications,
    });
  } catch (err) {
    return {
      status: "unresolved",
      code: "CALCULATION_ERROR",
      message: `Fehler bei der exakten Rechnungsberechnung: ${err instanceof Error ? err.message : String(err)}`,
      diagnostics: { details: err },
    };
  }

  // 7. Determine Invoice Period
  const shiftDates = assignmentProvenance.map((a) => a.shiftDate).sort();
  const periodStart = input.customPeriodStart || shiftDates[0];
  const periodEnd = input.customPeriodEnd || shiftDates[shiftDates.length - 1];
  const periodDisplay =
    periodStart === periodEnd
      ? formatIsoToGerman(periodStart)
      : `${formatIsoToGerman(periodStart)} – ${formatIsoToGerman(periodEnd)}`;

  const uniquePolicies = Array.from(policyVersionsMap.values());
  const uniquePriceVersions = Array.from(priceVersionsMap.values());

  const clientInfo = {
    facilityName: client.facilityName,
    internalNumber: client.internalNumber || null,
    shortCode: client.shortCode || null,
    address: client.address || null,
    billingEmail: client.billingEmail || null,
    billingInfo: client.billingInfo || null,
    paymentTermsDays: client.paymentTermsDays,
  };

  const totalNetMinutes = assignmentProvenance.reduce(
    (sum, a) => sum + a.netWorkMinutes,
    0
  );

  const snapshotData: V2InvoiceDraftSnapshotData = {
    calculationVersion: "v2",
    facilityName: client.facilityName,
    internalNumber: client.internalNumber || null,
    shortCode: client.shortCode || null,
    address: client.address || null,
    billingEmail: client.billingEmail || null,
    billingInfo: client.billingInfo || null,
    paymentTermsDays: client.paymentTermsDays,
    periodStart,
    periodEnd,
    items: calculationResult.items,
    subtotal: calculationResult.totals.subtotalDisplay,
    taxAmount: calculationResult.totals.taxAmountDisplay,
    total: calculationResult.totals.totalDisplay,
    subtotalCents: calculationResult.totals.subtotalCents,
    taxAmountCents: calculationResult.totals.taxAmountCents,
    totalCents: calculationResult.totals.totalCents,
    taxRatePercent: Math.round(
      (calculationResult.totals.taxRateRatio.numerator /
        calculationResult.totals.taxRateRatio.denominator) *
        100
    ),
    totalLineItemMinutes: calculationResult.totals.totalLineItemMinutes,
    netWorkMinutes: totalNetMinutes,
    isFrozen: true,
    preparedAt: new Date().toISOString(),
    pricingProvenance: {
      assignmentIds: assignments.map((a) => a.id),
      policyVersions: uniquePolicies,
      priceVersions: uniquePriceVersions,
    },
  };

  return {
    status: "resolved",
    calculationVersion: "v2",
    clientId,
    clientInfo,
    periodStart,
    periodEnd,
    periodDisplay,
    assignmentIds: assignments.map((a) => a.id),
    shiftCount: assignments.length,
    provenance: {
      assignments: assignmentProvenance,
      policyVersions: uniquePolicies,
      priceVersions: uniquePriceVersions,
    },
    items: calculationResult.items,
    totals: calculationResult.totals,
    snapshotData,
  };
}
