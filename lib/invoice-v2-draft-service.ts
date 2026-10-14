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
 * 5. Deterministic Break Placement:
 *    The operational default places a duration-only break in the middle of the
 *    effective shift. An explicit time entered during review replaces that default.
 *    The selected allocation is frozen in provenance and the draft hash.
 * 6. Single-Engine Exact Parity:
 *    Uses Phase 4b adapter (`convertPreparedItemsToRawInvoiceLines`) and Phase 2 engine
 *    (`calculateExactInvoice`). Produces identical items, totals, and snapshotData for DB,
 *    snapshot, and PDF in Phase 5b.
 */

import {
  calculateExactInvoice,
  formatHundredthsGerman,
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
import {
  getAssignmentEffectiveWorkHours,
  computeAssignmentEffectiveVersion,
} from "./confirmation-evidence-service";
import { netShiftHours } from "./pricing";
import { resolveClientPriceVersion } from "./client-price-resolver";
import { describeV2LineWithWorker } from "./invoice-v2-line-description";
import { prisma } from "./prisma";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function advanceCalendarDay(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const nextDate = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = nextDate.getUTCFullYear();
  const nm = pad2(nextDate.getUTCMonth() + 1);
  const nd = pad2(nextDate.getUTCDate());
  return `${ny}-${nm}-${nd}`;
}

function isValidIsoDateString(d: unknown): boolean {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [yStr, mStr, dStr] = d.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const day = Number(dStr);
  if (m < 1 || m > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, day));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === day
  );
}

export type V2InvoicePdfItem = {
  pos: number;
  description: string;
  hours: string;
  rate: string;
  amount: string;
};

export function convertCalculatedLineItemsToPdfItems(
  items: CalculatedLineItem[]
): V2InvoicePdfItem[] {
  return items.map((item) => ({
    pos: item.pos,
    description: item.description,
    hours: item.hoursDisplay,
    rate: formatHundredthsGerman(item.rateCents),
    amount: item.amountDisplay,
  }));
}

export type PriceVersionRecord = {
  priceVersionId: string;
  clientId: string;
  qualification: string;
  hourlyRateInCents: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null; // YYYY-MM-DD
  contractId?: string | null;
  sourceType?: string;
  sourceReference: string;
  sourceDocumentUrl?: string | null;
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
  // The operational default is a break centered in the shift. An administrator
  // may correct its start during review; both choices are part of the draft hash.
  breakStartByAssignment?: Record<string, string>;
  taxRate?: TaxRateSpecification; // defaults to 19% VAT
  customPeriodStart?: string;     // optional override (YYYY-MM-DD)
  customPeriodEnd?: string;       // optional override (YYYY-MM-DD)
  allowedQualifications?: readonly string[] | Set<string>;
  allowBilledForInvoiceId?: string; // Phase 6: allows assignments already billed to this specific invoice
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
  effectiveHours?: number;
  effectiveStartTime?: string;
  effectiveEndTime?: string;
  effectiveBreakMinutes?: number;
  allocatedBreakStart?: string;
  allocatedBreakEnd?: string;
  breakAllocationSource?: "midpoint_default" | "admin_override";
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
  pdfItems: V2InvoicePdfItem[];
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
    breakAllocations?: Array<{ assignmentId: string; start: string; end: string; minutes: number; source: "midpoint_default" | "admin_override" }>;
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
  pdfItems: V2InvoicePdfItem[];
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
  | "MISSING_QUALIFICATION"
  | "QUALIFICATION_CONFLICT"
  | "PRICE_UNRESOLVED"
  | "PRICE_VERSION_EXPIRED_MID_SHIFT"
  | "UNVERIFIED_BREAK_CLAUSE"
  | "UNRESOLVED_BREAK_ALLOCATION"
  | "POLICY_UNRESOLVED"
  | "POLICY_NOT_FROZEN"
  | "AMBIGUOUS_POLICY_OVERLAP"
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

  // Check billing status: if allowBilledForInvoiceId is passed (Phase 6 refresh),
  // verify all assignments are linked to THAT invoice. Otherwise (issuance), verify none are billed.
  if (input.allowBilledForInvoiceId) {
    const unlinkedOrForeign = rawAssignments.filter(
      (a) => a.invoiceId !== input.allowBilledForInvoiceId
    );
    if (unlinkedOrForeign.length > 0) {
      const first = unlinkedOrForeign[0];
      return {
        status: "unresolved",
        code: "ASSIGNMENT_NOT_LINKED_TO_INVOICE",
        message: `Schicht "${first.id}" ist nicht der Zielrechnung "${input.allowBilledForInvoiceId}" zugewiesen (aktueller Status: ${first.invoiceId ?? "unabgerechnet"}). Eine Aktualisierung darf nur bereits verknüpfte Schichten umfassen.`,
        diagnostics: {
          assignmentId: first.id,
          targetInvoiceId: input.allowBilledForInvoiceId,
          actualInvoiceId: first.invoiceId,
          unlinkedAssignmentIds: unlinkedOrForeign.map((a) => a.id),
        },
      };
    }
  } else {
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

  const selectedIds = new Set(assignments.map((assignment) => assignment.id));
  const reviewedBreaks = input.breakStartByAssignment ?? {};
  if (Object.keys(reviewedBreaks).some((id) => !selectedIds.has(id))) {
    return {
      status: "unresolved",
      code: "UNRESOLVED_BREAK_ALLOCATION",
      message: "Pausenzeiten dürfen nur für ausgewählte Schichten angegeben werden.",
      diagnostics: {},
    };
  }

  const clientId = clientIds[0];
  const client = assignments[0].order.client;

  // 5. Process Each Assignment Sequentially & Deterministically
  const allRawLines: RawWorkLineInput[] = [];
  const assignmentProvenance: V2InvoiceDraftAssignmentProvenance[] = [];
  const policyVersionsMap = new Map<string, { policyId: string; policyVersion: number; frozenHash: string }>();
  const priceVersionsMap = new Map<string, { priceVersionId: string; qualification: string; hourlyRateInCents: number; sourceReference: string }>();

  // Each effective-hours lookup performs two independent database reads. Warm
  // them in bounded batches so a month of shifts does not wait for every pair
  // in series. Results remain consumed in the deterministic assignment order.
  const effectiveHoursById = new Map<string, PromiseSettledResult<Awaited<ReturnType<typeof getAssignmentEffectiveWorkHours>>>>();
  if (!deps?.effectiveHoursResolver) {
    try {
      // Single database query for all approved corrections across the entire batch
      const approvedCorrections = await tx.workHoursCorrectionRequest.findMany({
        where: {
          assignmentId: { in: assignments.map((a) => a.id) },
          status: "approved",
        },
        orderBy: [
          { revision: "desc" },
          { decidedAt: "desc" },
          { requestedAt: "desc" },
          { id: "desc" },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const latestApprovedByAssignmentId = new Map<string, any>();
      for (const corr of approvedCorrections) {
        if (!latestApprovedByAssignmentId.has(corr.assignmentId)) {
          latestApprovedByAssignmentId.set(corr.assignmentId, corr);
        }
      }

      for (const assignment of assignments) {
        const approvedCorrection = latestApprovedByAssignmentId.get(assignment.id) || null;
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
          assignment.id,
          approvedCorrection,
          assignment.serviceConfirmation,
          assignment.order
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let effectiveData: any;
        if (approvedCorrection) {
          effectiveData = {
            assignmentId: assignment.id,
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
              requestedAt: approvedCorrection.requestedAt instanceof Date ? approvedCorrection.requestedAt.toISOString() : String(approvedCorrection.requestedAt),
              decidedById: approvedCorrection.decidedById,
              decidedAt: approvedCorrection.decidedAt
                ? (approvedCorrection.decidedAt instanceof Date ? approvedCorrection.decidedAt.toISOString() : String(approvedCorrection.decidedAt))
                : null,
              decisionNote: approvedCorrection.decisionNote,
            },
          };
        } else if (assignment.serviceConfirmation?.hoursWorked != null) {
          effectiveData = {
            assignmentId: assignment.id,
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
        } else {
          effectiveData = {
            assignmentId: assignment.id,
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

        effectiveHoursById.set(assignment.id, {
          status: "fulfilled",
          value: effectiveData,
        });
      }
    } catch (batchErr) {
      console.error("Batch effective hours failed:", batchErr);
      // Fallback to individual reads if batch query fails
      for (let offset = 0; offset < assignments.length; offset += 8) {
        const batch = assignments.slice(offset, offset + 8);
        const results = await Promise.allSettled(
          batch.map((assignment) => getAssignmentEffectiveWorkHours(assignment.id, tx))
        );
        batch.forEach((assignment, index) => effectiveHoursById.set(assignment.id, results[index]));
      }
    }
  }
  // Preload all frozen surcharge policies and hourly rate versions for this client once.
  // This collapses N * 6 sequential round-trips over the remote pooler into 2 fast reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let preloadedPolicies: any[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let preloadedRates: any[] | null = null;

  if (!deps?.facilityPolicyResolver) {
    try {
      preloadedPolicies = await tx.facilitySurchargePolicy.findMany({
        where: {
          clientId,
          isFrozen: true,
        },
      });
    } catch {
      preloadedPolicies = null;
    }
  }

  if (!deps?.priceVersionResolver) {
    try {
      preloadedRates = await tx.clientHourlyRateVersion.findMany({
        where: { clientId },
        include: {
          verifiedByUser: { select: { id: true, fullName: true, email: true } },
        },
      });
    } catch {
      preloadedRates = null;
    }
  }

  for (const assignment of assignments) {
    const shiftDateIso =
      assignment.order.shiftDate instanceof Date
        ? assignment.order.shiftDate.toISOString().slice(0, 10)
        : String(assignment.order.shiftDate).slice(0, 10);

    // 1. Qualification resolution & validation (Finding 2)
    const reqQual = assignment.order.requiredQualification?.trim() || null;
    const workQual = assignment.worker.qualification?.trim() || null;

    if (!reqQual && !workQual) {
      return {
        status: "unresolved",
        code: "MISSING_QUALIFICATION",
        message: `Schicht "${assignment.id}" (${assignment.worker.fullName}, ${shiftDateIso}) kann nicht abgerechnet werden: Weder im Auftrag noch beim Mitarbeiter ist eine Qualifikation hinterlegt. Ein stillschweigender Fallback auf "Pflegefachkraft" ist unzulässig.`,
        diagnostics: {
          assignmentId: assignment.id,
          workerId: assignment.worker.id,
          orderId: assignment.order.id,
        },
      };
    }

    if (reqQual && workQual && reqQual.toLowerCase() !== workQual.toLowerCase()) {
      return {
        status: "unresolved",
        code: "QUALIFICATION_CONFLICT",
        message: `Schicht "${assignment.id}" (${assignment.worker.fullName}, ${shiftDateIso}) weist einen Qualifikationskonflikt auf: Auftrag verlangt "${reqQual}", Mitarbeiter hat "${workQual}".`,
        diagnostics: {
          assignmentId: assignment.id,
          workerId: assignment.worker.id,
          orderId: assignment.order.id,
          requiredQualification: reqQual,
          workerQualification: workQual,
        },
      };
    }

    const qualification = (reqQual || workQual)!;

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
        const prefetched = effectiveHoursById.get(assignment.id);
        if (!prefetched) throw new Error("Effective-hours result missing");
        if (prefetched.status === "rejected") throw prefetched.reason;
        effectiveHoursData = prefetched.value;
      }
    } catch (err) {
      return {
        status: "unresolved",
        code: "INVALID_EFFECTIVE_HOURS",
        message: `Fehler beim Abrufen der effektiven Arbeitsstunden für Schicht "${assignment.id}": ${err instanceof Error ? err.message : String(err)}`,
        diagnostics: { assignmentId: assignment.id, details: err },
      };
    }

    // Determine shift span in half-open interval [start, end)
    const [startH, startMin] = effectiveHoursData.effectiveStartTime.split(":").map(Number);
    const [endH, endMin] = effectiveHoursData.effectiveEndTime.split(":").map(Number);
    const startTotalMin = startH * 60 + startMin;
    const endTotalMin = endH * 60 + endMin;
    // In [start, end), a shift only spans into the next day if it contains billable minutes on Day 2 (endTotalMin > 0).
    // Shifts ending at 00:00 (e.g. 23:00–00:00 or 00:00–00:00 per 24h duration contract) end at the Day 1 midnight boundary [startTotalMin, 1440)
    // with 0 minutes on Day 2. Only shifts with endTotalMin > 0 (e.g. 23:00–00:01) enter Day 2 [0, endTotalMin).
    const spansIntoNextDay = endTotalMin <= startTotalMin && endTotalMin > 0;
    const endShiftDateIso = spansIntoNextDay ? advanceCalendarDay(shiftDateIso) : shiftDateIso;
    const spannedDates = spansIntoNextDay ? [shiftDateIso, endShiftDateIso] : [shiftDateIso];

    // B. Phase 4a Surcharge Policy Resolution
    let resolvedPolicy: ResolvedSurchargePolicy | null = null;
    if (deps?.facilityPolicyResolver) {
      resolvedPolicy = await deps.facilityPolicyResolver({
        clientId,
        shiftDateIso,
      });
    } else {
      // Direct database resolution for frozen policy with strict ambiguity check
      try {
        const queryPolicies = async (targetDateIso: string) => {
          if (preloadedPolicies) {
            const targetDate = new Date(targetDateIso);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return preloadedPolicies.filter((p: any) => {
              if (p.clientId && p.clientId !== clientId) return false;
              if (p.isFrozen === false) return false;
              const from = p.effectiveFrom instanceof Date ? p.effectiveFrom : new Date(p.effectiveFrom);
              if (from > targetDate) return false;
              if (p.effectiveTo) {
                const to = p.effectiveTo instanceof Date ? p.effectiveTo : new Date(p.effectiveTo);
                if (to < targetDate) return false;
              }
              return true;
            });
          }

          return await tx.facilitySurchargePolicy.findMany({
            where: {
              clientId,
              effectiveFrom: { lte: new Date(targetDateIso) },
              OR: [
                { effectiveTo: null },
                { effectiveTo: { gte: new Date(targetDateIso) } },
              ],
              isFrozen: true,
            },
          });
        };

        const matchingPolicies = await queryPolicies(shiftDateIso);

        if (matchingPolicies.length > 1) {
          return {
            status: "unresolved",
            code: "AMBIGUOUS_POLICY_OVERLAP",
            message: `Mehrdeutige Zuschlagsrichtlinien für Kunde "${clientId}" zum Datum "${shiftDateIso}": Es wurden ${matchingPolicies.length} aktive eingefrorene Richtlinien gefunden (Versionen: ${matchingPolicies.map((p: { policyVersion: number }) => p.policyVersion).join(", ")}).`,
            diagnostics: {
              assignmentId: assignment.id,
              clientId,
              shiftDateIso,
              matchingPolicyIds: matchingPolicies.map((p: { id: string }) => p.id),
              policyVersions: matchingPolicies.map((p: { policyVersion: number }) => p.policyVersion),
            },
          };
        }

        if (matchingPolicies.length === 1) {
          const policyRecord = matchingPolicies[0];

          if (spansIntoNextDay) {
            const matchingPoliciesEnd = await queryPolicies(endShiftDateIso);

            if (matchingPoliciesEnd.length > 1) {
              return {
                status: "unresolved",
                code: "AMBIGUOUS_POLICY_OVERLAP",
                message: `Mehrdeutige Zuschlagsrichtlinien für Kunde "${clientId}" zum Datum des Schichtendes "${endShiftDateIso}": Es wurden ${matchingPoliciesEnd.length} aktive eingefrorene Richtlinien gefunden.`,
                diagnostics: {
                  assignmentId: assignment.id,
                  clientId,
                  shiftDateIso,
                  endShiftDateIso,
                  matchingPolicyIds: matchingPoliciesEnd.map((p: { id: string }) => p.id),
                  policyVersions: matchingPoliciesEnd.map((p: { policyVersion: number }) => p.policyVersion),
                },
              };
            }

            if (matchingPoliciesEnd.length === 0 || matchingPoliciesEnd[0].id !== policyRecord.id) {
              return {
                status: "unresolved",
                code: "POLICY_UNRESOLVED",
                message: `Die Zuschlagsrichtlinie für Schicht "${assignment.id}" deckt das Schichtende am "${endShiftDateIso}" nicht konsistent durch dieselbe Richtlinie ab.`,
                diagnostics: {
                  assignmentId: assignment.id,
                  clientId,
                  shiftDateIso,
                  endShiftDateIso,
                },
              };
            }
          }

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

    // Verify policy date validity across midnight rollover
    if (spansIntoNextDay && policySuccess.effectiveTo && policySuccess.effectiveTo < endShiftDateIso) {
      return {
        status: "unresolved",
        code: "POLICY_UNRESOLVED",
        message: `Die Zuschlagsrichtlinie (Version ${policySuccess.policyVersion}) für Schicht "${assignment.id}" läuft während der Nachtschicht ab (gültig bis ${policySuccess.effectiveTo}, Schichtende am ${endShiftDateIso}).`,
        diagnostics: {
          assignmentId: assignment.id,
          clientId,
          shiftDateIso,
          endShiftDateIso,
          policyId: policySuccess.policyId,
          effectiveTo: policySuccess.effectiveTo,
        },
      };
    }

    // C. Verifiable Dated Price Version Resolution
    let priceRecord: PriceVersionRecord | null = null;
    if (deps?.priceVersionResolver) {
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
    } else {
      // Default database resolver using verified dated prices from ClientHourlyRateVersion
      const resolvedDbPrice = await resolveClientPriceVersion({
        prisma: tx,
        clientId,
        qualification,
        shiftDateIso,
        contractId: assignment.contractId,
        spansIntoNextDay,
        endShiftDateIso,
        preloadedRates: preloadedRates ?? undefined,
      });

      if (resolvedDbPrice.status !== "resolved") {
        return {
          status: "unresolved",
          code: resolvedDbPrice.code === "AMBIGUOUS_PRICE_OVERLAP" ? "AMBIGUOUS_PRICE_OVERLAP" : "PRICE_UNRESOLVED",
          message: resolvedDbPrice.message,
          diagnostics: {
            assignmentId: assignment.id,
            clientId,
            qualification,
            shiftDateIso,
            ...resolvedDbPrice.diagnostics,
          },
        };
      }
      priceRecord = resolvedDbPrice.priceRecord;
    }

    // 1. Validate price record clientId (Finding 1)
    if (priceRecord.clientId !== clientId) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die aufgelöste Preisversion "${priceRecord.priceVersionId}" gehört zu Kunde "${priceRecord.clientId}", erwartet wurde aber Kunde "${clientId}".`,
        diagnostics: {
          assignmentId: assignment.id,
          expectedClientId: clientId,
          actualClientId: priceRecord.clientId,
          priceVersionId: priceRecord.priceVersionId,
        },
      };
    }

    // 2. Validate price record qualification (Finding 1)
    if (
      !priceRecord.qualification ||
      priceRecord.qualification.trim().toLowerCase() !== qualification.trim().toLowerCase()
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${priceRecord.priceVersionId}" gilt für Qualifikation "${priceRecord.qualification}", für Schicht "${assignment.id}" wird jedoch "${qualification}" benötigt.`,
        diagnostics: {
          assignmentId: assignment.id,
          expectedQualification: qualification,
          actualQualification: priceRecord.qualification,
          priceVersionId: priceRecord.priceVersionId,
        },
      };
    }

    // 3. Symmetrical validation of contractId
    const assignmentContractId = assignment.contractId?.trim() || null;
    const priceContractId = priceRecord.contractId?.trim() || null;
    // A frozen, administrator-confirmed client-profile setting applies to the
    // client across contracts unless a contract-specific price was selected.
    const clientWideSetting = Boolean(assignmentContractId) &&
      priceContractId === null && priceRecord.sourceType === "setting";
    if (assignmentContractId !== priceContractId && !clientWideSetting) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: assignmentContractId
          ? `Vertragskonflikt bei Preisversion "${priceRecord.priceVersionId}": Schicht ist an Vertrag "${assignmentContractId}" gebunden, die Preisversion hat jedoch ${priceContractId ? `Vertrag "${priceContractId}"` : "keinen Vertrag"}. Ein preislicher Fallback auf vertragslose Preise ist unzulässig.`
          : `Vertragskonflikt bei Preisversion "${priceRecord.priceVersionId}": Preisversion ist an Vertrag "${priceContractId}" gebunden, die Schicht hat jedoch keinen Vertrag.`,
        diagnostics: {
          assignmentId: assignment.id,
          assignmentContractId,
          priceContractId,
          priceVersionId: priceRecord.priceVersionId,
        },
      };
    }

    // 4. Validate price record rate and id
    if (
      !priceRecord.priceVersionId ||
      !priceRecord.priceVersionId.trim() ||
      !Number.isSafeInteger(priceRecord.hourlyRateInCents) ||
      priceRecord.hourlyRateInCents < 0
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

    // 5. Validate verification metadata (Finding 1)
    const isValidDateString = (dStr: unknown): boolean =>
      typeof dStr === "string" && dStr.trim().length > 0 && !isNaN(Date.parse(dStr));

    if (
      typeof priceRecord.verifiedBy !== "string" ||
      !priceRecord.verifiedBy.trim() ||
      !isValidDateString(priceRecord.verifiedAt) ||
      typeof priceRecord.sourceReference !== "string" ||
      !priceRecord.sourceReference.trim()
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${priceRecord.priceVersionId}" verfügt über unzureichende oder unbestätigte Verifizierungs-Metadaten (verifiedBy, verifiedAt oder sourceReference fehlen oder sind ungültig).`,
        diagnostics: {
          assignmentId: assignment.id,
          priceVersionId: priceRecord.priceVersionId,
          verifiedBy: priceRecord.verifiedBy,
          verifiedAt: priceRecord.verifiedAt,
          sourceReference: priceRecord.sourceReference,
        },
      };
    }

    // 6. Validate price date intervals and format (Finding 3)
    if (
      !isValidIsoDateString(priceRecord.effectiveFrom) ||
      (priceRecord.effectiveTo != null && !isValidIsoDateString(priceRecord.effectiveTo))
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${priceRecord.priceVersionId}" enthält ungültige Datumsformate für den Gültigkeitszeitraum.`,
        diagnostics: {
          assignmentId: assignment.id,
          effectiveFrom: priceRecord.effectiveFrom,
          effectiveTo: priceRecord.effectiveTo,
        },
      };
    }

    if (priceRecord.effectiveTo && priceRecord.effectiveFrom > priceRecord.effectiveTo) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Invertierter Gültigkeitszeitraum in Preisversion "${priceRecord.priceVersionId}": effectiveFrom (${priceRecord.effectiveFrom}) liegt nach effectiveTo (${priceRecord.effectiveTo}).`,
        diagnostics: {
          assignmentId: assignment.id,
          effectiveFrom: priceRecord.effectiveFrom,
          effectiveTo: priceRecord.effectiveTo,
        },
      };
    }

    // Check validity across all calendar days spanned by shift (including midnight rollover)
    for (const checkDate of spannedDates) {
      if (
        priceRecord.effectiveFrom > checkDate ||
        (priceRecord.effectiveTo && priceRecord.effectiveTo < checkDate)
      ) {
        return {
          status: "unresolved",
          code: "PRICE_UNRESOLVED",
          message: `Die Preisversion "${priceRecord.priceVersionId}" ist zum Datum "${checkDate}" nicht gültig (Gültigkeit: ${priceRecord.effectiveFrom} bis ${priceRecord.effectiveTo || "unbegrenzt"}). Die Schicht "${assignment.id}" erstreckt sich über dieses Datum.`,
          diagnostics: {
            assignmentId: assignment.id,
            shiftDateIso,
            endShiftDateIso,
            failedDateIso: checkDate,
            effectiveFrom: priceRecord.effectiveFrom,
            effectiveTo: priceRecord.effectiveTo,
          },
        };
      }
    }

    // D. Break location. The business rule places an otherwise untimed break
    // in the middle of the effective shift; a reviewed time replaces that default.
    // Neither path relies on a fabricated contractual proportional-allocation clause.
    const verifiedBreakClause: VerifiedContractBreakAllocationClause | undefined = undefined;
    const contractualBreakAllocationRule: "proportional" | null = null;
    const breakAllocationSourceReference: string | undefined = undefined;

    const breakMinutes = effectiveHoursData.effectiveBreakMinutes;
    const [startHours, startMinutes] = effectiveHoursData.effectiveStartTime.split(":").map(Number);
    const [endHours, endMinutes] = effectiveHoursData.effectiveEndTime.split(":").map(Number);
    const shiftStartMinute = startHours * 60 + startMinutes;
    const shiftEndMinute = endHours * 60 + endMinutes;
    const grossMinutes = (shiftEndMinute - shiftStartMinute + 1440) % 1440;
    const hasValidDuration = Number.isInteger(breakMinutes) && breakMinutes > 0 && breakMinutes < grossMinutes;
    const midpointMinute = hasValidDuration
      ? (shiftStartMinute + Math.floor((grossMinutes - breakMinutes) / 2)) % 1440
      : null;
    const midpointStart = midpointMinute === null
      ? undefined
      : `${pad2(Math.floor(midpointMinute / 60))}:${pad2(midpointMinute % 60)}`;
    const overrideStart = reviewedBreaks[assignment.id];
    const allocatedBreakStart = overrideStart ?? midpointStart;
    let allocatedBreakEnd: string | undefined;
    let breakDateIso = shiftDateIso;
    if (allocatedBreakStart !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(allocatedBreakStart) || !hasValidDuration) {
        return {
          status: "unresolved",
          code: "UNRESOLVED_BREAK_ALLOCATION",
          message: `Ungültiger Pausenbeginn oder Pausendauer für Schicht "${assignment.id}". Bitte die tatsächliche Uhrzeit als HH:mm eingeben.`,
          diagnostics: { assignmentId: assignment.id, breakMinutes },
        };
      }
      const [hours, minutes] = allocatedBreakStart.split(":").map(Number);
      const endMinute = (hours * 60 + minutes + breakMinutes) % 1440;
      allocatedBreakEnd = `${pad2(Math.floor(endMinute / 60))}:${pad2(endMinute % 60)}`;
      if (effectiveHoursData.effectiveEndTime < effectiveHoursData.effectiveStartTime &&
          allocatedBreakStart < effectiveHoursData.effectiveStartTime) {
        breakDateIso = advanceCalendarDay(shiftDateIso);
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
      breakWindows: allocatedBreakStart && allocatedBreakEnd
        ? [{ start: allocatedBreakStart, end: allocatedBreakEnd, dateIso: breakDateIso }]
        : undefined,
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
      effectiveHours: effectiveHoursData.effectiveHours,
      effectiveStartTime: effectiveHoursData.effectiveStartTime,
      effectiveEndTime: effectiveHoursData.effectiveEndTime,
      effectiveBreakMinutes: effectiveHoursData.effectiveBreakMinutes,
      allocatedBreakStart,
      allocatedBreakEnd,
      breakAllocationSource: allocatedBreakStart
        ? overrideStart === undefined ? "midpoint_default" : "admin_override"
        : undefined,
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

  const invoiceItems = calculationResult.items.map((item) => ({
    ...item,
    description: describeV2LineWithWorker(item),
  }));
  const pdfItems = convertCalculatedLineItemsToPdfItems(invoiceItems);

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
    items: invoiceItems,
    pdfItems,
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
      breakAllocations: assignmentProvenance
        .filter((a) => a.allocatedBreakStart && a.allocatedBreakEnd && a.breakAllocationSource)
        .map((a) => ({
          assignmentId: a.assignmentId,
          start: a.allocatedBreakStart!,
          end: a.allocatedBreakEnd!,
          minutes: a.breakMinutes,
          source: a.breakAllocationSource!,
        })),
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
    items: invoiceItems,
    pdfItems,
    totals: calculationResult.totals,
    snapshotData,
  };
}
