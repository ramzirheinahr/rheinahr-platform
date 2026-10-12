/**
 * Restricted Administrative Review and Ingestion Service for Facility Surcharge Policies
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Core Guarantees:
 * 1. Strict Contractual Provenance & Zero Implicit Defaults:
 *    Surcharge policies cannot assume 0% or platform defaults silently.
 *    Any 0% surcharge rate requires an explicit contractual rationale.
 * 2. Mandatory Documentary Backing & Verifier Proof:
 *    Backed by a signed client contract or a signed facility framework agreement.
 *    Verifier must match the authenticated acting administrator session.
 * 3. Immutable Pre-Freeze Verification & Canonical Hash Binding:
 *    Preview produces an auditable canonical SHA-256 hash. Committing requires
 *    matching the preview hash exactly.
 * 4. Total Immutability Post-Freeze:
 *    Once frozen, policies cannot be modified or deleted.
 */

import {
  computePolicyCanonicalHash,
  validatePolicyIntervalOverlap,
  type FacilitySurchargePolicyRecord,
} from "./surcharge-policy";
import {
  validateFacilitySurchargePolicyIntake,
  type FacilitySurchargePolicyIntakeInput,
} from "./facility-surcharge-policy-template";
import { toIsoDay } from "./client-price-resolver";
import type { SurchargeCombinationRule, SurchargePolicySourceType } from "@prisma/client";

export type FacilitySurchargePolicyPreviewSummary = {
  isValid: boolean;
  scope: {
    clientId: string;
    facilityName: string;
    clientContractId: string | null;
    contractPeriod: string | null;
    isGeneralScope: boolean;
  };
  terms: {
    policyVersion: number;
    federalState: string;
    municipality: string | null;
    districtLocality: string | null;
    surchargeSat: number;
    surchargeSun: number;
    surchargeHoliday: number;
    surchargeNight: number;
    nightStart: string;
    nightEnd: string;
    combinationRule: SurchargeCombinationRule;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  provenance: {
    sourceType: SurchargePolicySourceType;
    sourceReference: string;
    sourceDocumentUrl: string | null;
    verifyingUser: {
      id: string;
      fullName: string | null;
      email: string;
      role: string;
    };
    verifiedAtIso: string;
  };
  integrity: {
    canonicalHash: string;
    isFrozen: true;
  };
  validationErrors?: string[];
};

export type AdminSurchargeServiceResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string; details?: Record<string, unknown> };

/**
 * Verifies that the acting user has administrative privileges.
 */
async function verifyAdminUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  userId: string
): Promise<
  | { success: true; user: { id: string; fullName: string | null; email: string; role: string } }
  | { success: false; code: string; message: string }
> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true, role: true, active: true },
  });

  if (!user || user.active === false) {
    return {
      success: false,
      code: "USER_NOT_FOUND_OR_INACTIVE",
      message: `Benutzer "${userId}" existiert nicht oder ist deaktiviert.`,
    };
  }

  if (user.role !== "admin" && user.role !== "super_admin") {
    return {
      success: false,
      code: "INSUFFICIENT_PERMISSIONS",
      message: `Benutzer "${user.email}" besitzt keine Administrator-Berechtigung (Rolle: "${user.role}"). Nur Administratoren dürfen Zuschlagsrichtlinien erfassen oder prüfen.`,
    };
  }

  return { success: true, user };
}

/**
 * Generates an immutable preview summary for a facility surcharge policy.
 */
export async function previewFacilitySurchargePolicy(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  input: unknown;
  actorUserId: string;
}): Promise<AdminSurchargeServiceResult<FacilitySurchargePolicyPreviewSummary>> {
  const { prisma, input, actorUserId } = params;

  // 1. Authorization check
  const actorCheck = await verifyAdminUser(prisma, actorUserId);
  if (!actorCheck.success) {
    return actorCheck;
  }
  const actor = actorCheck.user;

  // 2. Syntactic & domain intake validation
  const raw = input as Partial<FacilitySurchargePolicyIntakeInput>;
  const valResult = validateFacilitySurchargePolicyIntake(raw);
  if (!valResult.valid || !valResult.sanitizedPolicy) {
    return {
      success: false,
      code: "INVALID_POLICY_INPUT",
      message: "Ungültige Eingabedaten für Zuschlagsrichtlinie.",
      details: { errors: valResult.errors },
    };
  }

  const sanitized = valResult.sanitizedPolicy;

  // 3. Verifier binding check
  if (sanitized.verifiedByUserId !== actorUserId) {
    return {
      success: false,
      code: "FORGED_VERIFIER_IDENTITY",
      message: `Der angemeldete Administrator ("${actor.email}") kann keine Zuschlagsrichtlinie im Namen eines abweichenden Prüfers ("${sanitized.verifiedByUserId}") verifizieren.`,
    };
  }

  // 4. Verify Client existence & framework agreement
  const client = await prisma.client.findUnique({
    where: { id: sanitized.clientId },
    select: {
      id: true,
      facilityName: true,
      frameworkAgreementSignedAt: true,
      frameworkAgreementUrl: true,
    },
  });

  if (!client) {
    return {
      success: false,
      code: "CLIENT_NOT_FOUND",
      message: `Kunde mit ID "${sanitized.clientId}" wurde nicht gefunden.`,
    };
  }

  let contractPeriod: string | null = null;
  let resolvedDocumentUrl: string | null = null;

  if (sanitized.clientContractId) {
    const contract = await prisma.clientContract.findUnique({
      where: { id: sanitized.clientContractId },
      select: {
        id: true,
        clientId: true,
        period: true,
        status: true,
        signedAt: true,
        documentUrl: true,
      },
    });

    if (!contract) {
      return {
        success: false,
        code: "CONTRACT_NOT_FOUND",
        message: `Vertrag mit ID "${sanitized.clientContractId}" wurde nicht gefunden.`,
      };
    }

    if (contract.clientId !== sanitized.clientId) {
      return {
        success: false,
        code: "CONTRACT_CLIENT_MISMATCH",
        message: `Vertrag "${sanitized.clientContractId}" gehört zu Kunde "${contract.clientId}", nicht zu dem angegebenen Kunden "${sanitized.clientId}".`,
      };
    }

    if (
      contract.status !== "signed" ||
      !contract.signedAt ||
      !contract.documentUrl ||
      !contract.documentUrl.trim()
    ) {
      return {
        success: false,
        code: "CONTRACT_NOT_SIGNED_OR_ACTIVE",
        message: `Vertrag "${sanitized.clientContractId}" ist nicht im Status "signed" oder verfügt über keine gültige Signatur/Urkunden-URL.`,
      };
    }

    resolvedDocumentUrl = contract.documentUrl.trim();
    contractPeriod = contract.period ?? null;
  } else {
    // General facility scope
    const hasSignedDate = Boolean(client.frameworkAgreementSignedAt);
    const hasDocUrl = Boolean(client.frameworkAgreementUrl && client.frameworkAgreementUrl.trim());

    if (!hasSignedDate || !hasDocUrl) {
      return {
        success: false,
        code: "GENERAL_SCOPE_LACKS_DOCUMENTATION",
        message:
          "Für allgemeine Einrichtungspolicen ohne Einzelvertrag muss eine vollständig nachgewiesene Rahmenvereinbarung hinterlegt sein.",
      };
    }

    resolvedDocumentUrl = client.frameworkAgreementUrl.trim();
  }

  // 5. Existing policies & interval overlap check
  const existingPolicies = await prisma.facilitySurchargePolicy.findMany({
    where: { clientId: sanitized.clientId },
    orderBy: { policyVersion: "desc" },
  });

  const effFromStr = toIsoDay(sanitized.effectiveFrom)!;
  const effToStr = sanitized.effectiveTo ? toIsoDay(sanitized.effectiveTo) : null;

  const candidateRecord: FacilitySurchargePolicyRecord = {
    clientId: sanitized.clientId,
    clientContractId: sanitized.clientContractId,
    policyVersion: sanitized.policyVersion,
    federalState: sanitized.federalState,
    municipality: sanitized.municipality,
    districtLocality: sanitized.districtLocality,
    surchargeSat: sanitized.surchargeSat,
    surchargeSun: sanitized.surchargeSun,
    surchargeHoliday: sanitized.surchargeHoliday,
    surchargeNight: sanitized.surchargeNight,
    nightStart: sanitized.nightStart,
    nightEnd: sanitized.nightEnd,
    combinationRule: sanitized.combinationRule,
    sourceType: sanitized.sourceType,
    sourceReference: sanitized.sourceReference,
    effectiveFrom: effFromStr,
    effectiveTo: effToStr,
  };

  type ExistingPolicyRow = {
    clientId: string;
    policyVersion: number;
    effectiveFrom: Date | string;
    effectiveTo: Date | string | null;
    federalState: string;
    surchargeSat: number;
    surchargeSun: number;
    surchargeHoliday: number;
    surchargeNight: number;
    sourceReference: string;
  };

  const allPoliciesForOverlap: FacilitySurchargePolicyRecord[] = [
    ...existingPolicies.map((p: ExistingPolicyRow) => ({
      clientId: p.clientId,
      policyVersion: p.policyVersion,
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      federalState: p.federalState,
      surchargeSat: p.surchargeSat,
      surchargeSun: p.surchargeSun,
      surchargeHoliday: p.surchargeHoliday,
      surchargeNight: p.surchargeNight,
      sourceReference: p.sourceReference,
    })),
    candidateRecord,
  ];

  const overlapCheck = validatePolicyIntervalOverlap(allPoliciesForOverlap);
  if (!overlapCheck.valid) {
    return {
      success: false,
      code: "OVERLAPPING_POLICY_INTERVAL",
      message:
        overlapCheck.conflict?.reason ||
        `Gültigkeitszeitraum [${effFromStr} .. ${effToStr ?? "offen"}] überschneidet sich mit einer bestehenden Zuschlagsrichtlinie.`,
      details: { conflict: overlapCheck.conflict },
    };
  }

  const nextPolicyVersion =
    existingPolicies.length > 0
      ? Math.max(...existingPolicies.map((p: ExistingPolicyRow) => p.policyVersion || 0)) + 1
      : 1;

  // 6. Canonical Hash Computation
  const canonicalHash = computePolicyCanonicalHash({
    clientId: sanitized.clientId,
    clientContractId: sanitized.clientContractId ?? null,
    policyVersion: nextPolicyVersion,
    federalState: sanitized.federalState,
    municipality: sanitized.municipality,
    districtLocality: sanitized.districtLocality,
    surchargeSat: sanitized.surchargeSat,
    surchargeSun: sanitized.surchargeSun,
    surchargeHoliday: sanitized.surchargeHoliday,
    surchargeNight: sanitized.surchargeNight,
    nightStart: sanitized.nightStart,
    nightEnd: sanitized.nightEnd,
    combinationRule: sanitized.combinationRule,
    sourceType: sanitized.sourceType,
    sourceReference: sanitized.sourceReference,
    effectiveFrom: effFromStr,
    effectiveTo: effToStr,
  });

  const verifiedAtIso = sanitized.verifiedAt.toISOString();

  const previewSummary: FacilitySurchargePolicyPreviewSummary = {
    isValid: true,
    scope: {
      clientId: client.id,
      facilityName: client.facilityName,
      clientContractId: sanitized.clientContractId,
      contractPeriod,
      isGeneralScope: sanitized.clientContractId === null,
    },
    terms: {
      policyVersion: nextPolicyVersion,
      federalState: sanitized.federalState,
      municipality: sanitized.municipality,
      districtLocality: sanitized.districtLocality,
      surchargeSat: sanitized.surchargeSat,
      surchargeSun: sanitized.surchargeSun,
      surchargeHoliday: sanitized.surchargeHoliday,
      surchargeNight: sanitized.surchargeNight,
      nightStart: sanitized.nightStart,
      nightEnd: sanitized.nightEnd,
      combinationRule: sanitized.combinationRule,
      effectiveFrom: effFromStr,
      effectiveTo: effToStr,
    },
    provenance: {
      sourceType: sanitized.sourceType,
      sourceReference: sanitized.sourceReference,
      sourceDocumentUrl: resolvedDocumentUrl,
      verifyingUser: {
        id: actor.id,
        fullName: actor.fullName,
        email: actor.email,
        role: actor.role,
      },
      verifiedAtIso,
    },
    integrity: {
      canonicalHash,
      isFrozen: true,
    },
  };

  return { success: true, data: previewSummary };
}

/**
 * Creates, verifies, and permanently freezes a facility surcharge policy.
 */
export async function createAndFreezeFacilitySurchargePolicy(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  input: unknown;
  actorUserId: string;
  expectedPreviewHash: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<AdminSurchargeServiceResult<any>> {
  const { prisma, input, actorUserId, expectedPreviewHash } = params;

  if (!expectedPreviewHash || typeof expectedPreviewHash !== "string" || !expectedPreviewHash.trim()) {
    return {
      success: false,
      code: "MISSING_PREVIEW_HASH",
      message:
        "Das Einfrieren erfordert die Angabe des zuvor geprüften Vorschau-Hashs (expectedPreviewHash).",
    };
  }

  const preview = await previewFacilitySurchargePolicy({ prisma, input, actorUserId });
  if (!preview.success) {
    return preview;
  }

  const p = preview.data;

  if (p.integrity.canonicalHash !== expectedPreviewHash.trim()) {
    return {
      success: false,
      code: "PREVIEW_HASH_MISMATCH",
      message: `Die zu speichernden Zuschlagsdaten stimmen nicht mit dem freigegebenen Vorschau-Hash überein (erwartet: "${expectedPreviewHash}", berechnet: "${p.integrity.canonicalHash}").`,
      details: {
        expectedPreviewHash,
        calculatedHash: p.integrity.canonicalHash,
      },
    };
  }

  const createdRecord = await prisma.facilitySurchargePolicy.create({
    data: {
      clientId: p.scope.clientId,
      clientContractId: p.scope.clientContractId,
      policyVersion: p.terms.policyVersion,
      federalState: p.terms.federalState,
      municipality: p.terms.municipality,
      districtLocality: p.terms.districtLocality,
      surchargeSat: p.terms.surchargeSat,
      surchargeSun: p.terms.surchargeSun,
      surchargeHoliday: p.terms.surchargeHoliday,
      surchargeNight: p.terms.surchargeNight,
      nightStart: p.terms.nightStart,
      nightEnd: p.terms.nightEnd,
      combinationRule: p.terms.combinationRule,
      sourceType: p.provenance.sourceType,
      sourceReference: p.provenance.sourceReference,
      verifiedByUserId: p.provenance.verifyingUser.id,
      verifiedAt: new Date(p.provenance.verifiedAtIso),
      effectiveFrom: new Date(p.terms.effectiveFrom),
      effectiveTo: p.terms.effectiveTo ? new Date(p.terms.effectiveTo) : null,
      isFrozen: true,
      frozenAt: new Date(),
      frozenHash: p.integrity.canonicalHash,
    },
  });

  return { success: true, data: createdRecord };
}
