/**
 * Phase 07e: Qualification Conflict Administrative Review Audit List
 *
 * Implements Management Decision (docs/audit/PHASE_07D_MANAGEMENT_ACCOUNTING_DECISIONS_AR.md §2):
 * - Keeps QUALIFICATION_CONFLICT strictly blocking (fail-closed).
 * - Forbids any automatic mapping/conversion between betreuungskraft and pflegehelfer.
 * - Provides administrative review list displaying order, worker, shift date, and contractual reference requirement.
 * - Protects privacy by omitting raw PII (names, personal addresses) and exposing only structural identifiers.
 */

import type { Qualification } from "@/lib/validations";

export interface QualificationConflictAuditItem {
  auditId: string;
  orderId: string;
  workerId: string;
  shiftDate: string; // YYYY-MM-DD
  requiredQualification: Qualification;
  workerQualification: Qualification;
  discrepancyType: "MISMATCHED_QUALIFICATION";
  blockingCode: "QUALIFICATION_CONFLICT";
  requiresContractAmendment: boolean;
  requiresHrVerification: boolean;
  status: "BLOCKED_PENDING_REVIEW";
  resolutionProtocol: {
    automaticConversionAllowed: false; // Explicit policy: NEVER true
    permittedActions: [
      "VERIFY_HR_RECORD_CORRECTION",      // Correct worker qualification if HR dossier proves misclassification
      "VERIFY_CONTRACTUAL_AMENDMENT",    // Explicit contract amendment signed by facility accepting pflegehelfer
      "EXCLUDE_SHIFT_FROM_INVOICING"      // Cancel or exclude shift from invoice calculation
    ];
  };
}

export interface QualificationConflictResolutionSubmission {
  auditId: string;
  orderId: string;
  workerId: string;
  chosenAction: "VERIFY_HR_RECORD_CORRECTION" | "VERIFY_CONTRACTUAL_AMENDMENT" | "EXCLUDE_SHIFT_FROM_INVOICING";
  documentReference: string; // Contract citation or HR file number
  verifiedByAdminId: string;
  verificationNotes: string;
}

export interface ResolutionValidationResult {
  accepted: boolean;
  reason?: string;
}

/**
 * Validates a submitted qualification conflict resolution.
 * Strictly prevents automated conversions and mandates explicit proof.
 */
export function validateQualificationConflictResolution(
  submission: unknown
): ResolutionValidationResult {
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
    return {
      accepted: false,
      reason: "Ungültige Einreichung: Einreichungsdaten müssen ein JSON-Objekt sein.",
    };
  }

  const s = submission as Partial<QualificationConflictResolutionSubmission>;

  if (!s.auditId || !s.orderId || !s.workerId) {
    return {
      accepted: false,
      reason: "Prüfungsreferenzen unvollständig (auditId, orderId oder workerId fehlt).",
    };
  }

  const allowedActions = [
    "VERIFY_HR_RECORD_CORRECTION",
    "VERIFY_CONTRACTUAL_AMENDMENT",
    "EXCLUDE_SHIFT_FROM_INVOICING",
  ];

  if (!s.chosenAction || !allowedActions.includes(s.chosenAction)) {
    return {
      accepted: false,
      reason: `Unzulässige Lösungsaktion. Eine automatische Umschlüsselung (z. B. Betreuungskraft <-> Pflegehelfer) ist strikt verboten. Zulässige Aktionen: ${allowedActions.join(", ")}.`,
    };
  }

  if (!s.documentReference || typeof s.documentReference !== "string" || !s.documentReference.trim()) {
    return {
      accepted: false,
      reason: "Ein dokumentierter Nachweis (documentReference: Vertragszusatz oder HR-Akte) ist zwingend erforderlich.",
    };
  }

  if (!s.verifiedByAdminId || typeof s.verifiedByAdminId !== "string" || !s.verifiedByAdminId.trim()) {
    return {
      accepted: false,
      reason: "Die Prüfung muss von einem namentlich dokumentierten Administrator abgezeichnet werden (verifiedByAdminId fehlt).",
    };
  }

  return { accepted: true };
}

/**
 * Synthetic illustrative examples of pilot qualification conflict cases constructed for testing.
 * IMPORTANT: These are synthetic test fixtures and schema demonstrations, NOT live HR dossiers
 * or approved waivers. No production policy or blanket exception should be enacted from these examples.
 */
export const SYNTHETIC_PILOT_QUALIFICATION_CONFLICT_EXAMPLES: QualificationConflictAuditItem[] = [
  {
    auditId: "QC-2026-PILOT-001",
    orderId: "ord-hist-pilot-3",
    workerId: "wrk-hist-pilot-3",
    shiftDate: "2026-09-14",
    requiredQualification: "betreuungskraft",
    workerQualification: "pflegehelfer",
    discrepancyType: "MISMATCHED_QUALIFICATION",
    blockingCode: "QUALIFICATION_CONFLICT",
    requiresContractAmendment: true,
    requiresHrVerification: true,
    status: "BLOCKED_PENDING_REVIEW",
    resolutionProtocol: {
      automaticConversionAllowed: false,
      permittedActions: [
        "VERIFY_HR_RECORD_CORRECTION",
        "VERIFY_CONTRACTUAL_AMENDMENT",
        "EXCLUDE_SHIFT_FROM_INVOICING",
      ],
    },
  },
  {
    auditId: "QC-2026-PILOT-002",
    orderId: "ord-hist-pilot-4",
    workerId: "wrk-hist-pilot-4",
    shiftDate: "2026-09-21",
    requiredQualification: "betreuungskraft",
    workerQualification: "pflegehelfer",
    discrepancyType: "MISMATCHED_QUALIFICATION",
    blockingCode: "QUALIFICATION_CONFLICT",
    requiresContractAmendment: true,
    requiresHrVerification: true,
    status: "BLOCKED_PENDING_REVIEW",
    resolutionProtocol: {
      automaticConversionAllowed: false,
      permittedActions: [
        "VERIFY_HR_RECORD_CORRECTION",
        "VERIFY_CONTRACTUAL_AMENDMENT",
        "EXCLUDE_SHIFT_FROM_INVOICING",
      ],
    },
  },
];

// Preserved for backward compatibility
export const PILOT_QUALIFICATION_CONFLICT_AUDIT_LIST = SYNTHETIC_PILOT_QUALIFICATION_CONFLICT_EXAMPLES;

/**
 * Safe reader utility: Extracts actual qualification conflicts from verified assignment records.
 * Strips personal identifying information (worker names, client names) and retains only structural audit references.
 */
export function extractQualificationConflictsFromAssignments(
  assignments: Array<{
    id: string;
    order: {
      id: string;
      shiftDate: Date | string;
      requiredQualification: string;
    };
    worker: {
      id: string;
      qualification: string;
    };
  }>
): QualificationConflictAuditItem[] {
  const conflicts: QualificationConflictAuditItem[] = [];

  for (const asgn of assignments) {
    const reqQual = asgn.order.requiredQualification as Qualification;
    const wrkQual = asgn.worker.qualification as Qualification;

    if (reqQual && wrkQual && reqQual !== wrkQual) {
      const shiftDateStr =
        asgn.order.shiftDate instanceof Date
          ? asgn.order.shiftDate.toISOString().slice(0, 10)
          : String(asgn.order.shiftDate).slice(0, 10);

      conflicts.push({
        auditId: `QC-EXTRACT-${asgn.order.id.slice(0, 8)}-${asgn.worker.id.slice(0, 8)}`,
        orderId: asgn.order.id,
        workerId: asgn.worker.id,
        shiftDate: shiftDateStr,
        requiredQualification: reqQual,
        workerQualification: wrkQual,
        discrepancyType: "MISMATCHED_QUALIFICATION",
        blockingCode: "QUALIFICATION_CONFLICT",
        requiresContractAmendment: true,
        requiresHrVerification: true,
        status: "BLOCKED_PENDING_REVIEW",
        resolutionProtocol: {
          automaticConversionAllowed: false,
          permittedActions: [
            "VERIFY_HR_RECORD_CORRECTION",
            "VERIFY_CONTRACTUAL_AMENDMENT",
            "EXCLUDE_SHIFT_FROM_INVOICING",
          ],
        },
      });
    }
  }

  return conflicts;
}
