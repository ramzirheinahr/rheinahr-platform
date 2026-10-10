/**
 * Restricted Administrative Ingestion and Review Service for Documented Client Hourly Rates (Phase 5b-2a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Core Guarantees:
 * 1. Strict Contractual Provenance & Zero Automatic Extraction:
 *    Rates can ONLY be ingested from authentic signed contracts, amendments, framework agreements,
 *    or judicial settlements. Automatic extraction from unversioned live fields (e.g. Client.hourlyRates)
 *    is strictly prohibited and rejected.
 * 2. Immutable Pre-Freeze Verification & Canonical Hash:
 *    Provides a structured, human-auditable preview of all rate terms, scope, validity interval,
 *    and source references before freezing. Computes the canonical SHA-256 hash across stored terms.
 * 3. Total Immutability Post-Freeze:
 *    Once frozen (isFrozen = true), price amount, contractual scope, qualification, validity interval,
 *    and source references cannot be modified or deleted. Corrections must be issued as a new rate version
 *    following a non-overlapping validity policy.
 * 4. Strict Role-Based Administrative Authorization:
 *    Ingestion, review, and freezing require verified active administrative credentials (admin or super_admin).
 */

import {
  computeRateVersionCanonicalHash,
  isValidIsoDateString,
  toIsoDay,
} from "./client-price-resolver";

export const ALLOWED_DOCUMENTED_SOURCE_TYPES = [
  "contract",
  "contract_amendment",
  "framework_agreement",
  "court_settlement",
] as const;

export type DocumentedPriceSourceType = (typeof ALLOWED_DOCUMENTED_SOURCE_TYPES)[number];

export type ClientHourlyRateInput = {
  clientId: string;
  clientContractId?: string | null;
  qualification: string;
  hourlyRateInCents: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo?: string | null; // YYYY-MM-DD or null
  sourceType: DocumentedPriceSourceType;
  sourceReference: string;
  verifyingUserId: string;
};

export type RateVersionPreviewSummary = {
  isValid: boolean;
  scope: {
    clientId: string;
    clientName: string;
    clientContractId: string | null;
    contractPeriod: string | null;
    isGeneralScope: boolean;
  };
  rateTerms: {
    qualification: string;
    normalizedQualification: string;
    hourlyRateInCents: number;
    hourlyRateFormattedEur: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    rateVersion: number;
  };
  provenance: {
    sourceType: DocumentedPriceSourceType;
    sourceReference: string;
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
  warnings?: string[];
};

export type AdminServiceResult<T> =
  | { success: true; data: T }
  | { success: false; code: string; message: string; details?: Record<string, unknown> };

/**
 * Validates the raw syntactic and semantic structure of a rate version input.
 */
export function validateClientHourlyRateInput(
  raw: unknown
): { isValid: boolean; errors: string[]; validatedInput?: ClientHourlyRateInput } {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { isValid: false, errors: ["Eingabedaten müssen ein Objekt sein."] };
  }

  const input = raw as Partial<ClientHourlyRateInput>;

  // Client ID
  if (!input.clientId || typeof input.clientId !== "string" || !input.clientId.trim()) {
    errors.push("Kunden-ID (clientId) ist erforderlich und darf nicht leer sein.");
  }

  // Contract ID (optional, but if provided must be non-empty string or null)
  let cleanContractId: string | null = null;
  if (input.clientContractId !== undefined && input.clientContractId !== null) {
    if (typeof input.clientContractId !== "string" || !input.clientContractId.trim()) {
      errors.push("Vertrags-ID (clientContractId) muss ein nicht-leerer String oder null sein.");
    } else {
      cleanContractId = input.clientContractId.trim();
    }
  }

  // Qualification
  if (!input.qualification || typeof input.qualification !== "string" || !input.qualification.trim()) {
    errors.push("Qualifikation (qualification) ist erforderlich und darf nicht leer sein.");
  }

  // Hourly Rate in Cents
  if (
    typeof input.hourlyRateInCents !== "number" ||
    !Number.isInteger(input.hourlyRateInCents) ||
    input.hourlyRateInCents <= 0
  ) {
    errors.push(
      "Stundensatz in Cent (hourlyRateInCents) muss eine positive ganze Zahl größer als 0 sein."
    );
  }

  // Effective From
  if (!input.effectiveFrom || !isValidIsoDateString(input.effectiveFrom)) {
    errors.push(
      `Gültig-Ab-Datum (effectiveFrom: "${input.effectiveFrom}") ist ungültig. Erwartet wird ein valides ISO-Datum (YYYY-MM-DD).`
    );
  } else {
    const year = Number(input.effectiveFrom.slice(0, 4));
    if (year < 2000 || year > 2100) {
      errors.push(`Gültig-Ab-Datum ("${input.effectiveFrom}") liegt außerhalb des zulässigen Bereichs (2000–2100).`);
    }
  }

  // Effective To
  let cleanEffectiveTo: string | null = null;
  if (input.effectiveTo !== undefined && input.effectiveTo !== null && input.effectiveTo !== "") {
    if (!isValidIsoDateString(input.effectiveTo)) {
      errors.push(
        `Gültig-Bis-Datum (effectiveTo: "${input.effectiveTo}") ist ungültig. Erwartet wird ein valides ISO-Datum (YYYY-MM-DD).`
      );
    } else {
      cleanEffectiveTo = input.effectiveTo;
      const year = Number(input.effectiveTo.slice(0, 4));
      if (year < 2000 || year > 2100) {
        errors.push(`Gültig-Bis-Datum ("${input.effectiveTo}") liegt außerhalb des zulässigen Bereichs (2000–2100).`);
      }
      if (input.effectiveFrom && isValidIsoDateString(input.effectiveFrom)) {
        if (input.effectiveFrom > input.effectiveTo) {
          errors.push(
            `Invertierter Gültigkeitszeitraum: effectiveFrom ("${input.effectiveFrom}") liegt nach effectiveTo ("${input.effectiveTo}").`
          );
        }
      }
    }
  }

  // Source Type
  if (
    !input.sourceType ||
    !ALLOWED_DOCUMENTED_SOURCE_TYPES.includes(input.sourceType as DocumentedPriceSourceType)
  ) {
    errors.push(
      `Quelltyp (sourceType: "${input.sourceType}") ist unzulässig. Erlaubt sind ausschließlich: ${ALLOWED_DOCUMENTED_SOURCE_TYPES.join(", ")}. Automatische Extraktion aus Altdaten ist verboten.`
    );
  }

  // Source Reference
  if (
    !input.sourceReference ||
    typeof input.sourceReference !== "string" ||
    input.sourceReference.trim().length < 5
  ) {
    errors.push(
      "Quellreferenz (sourceReference) muss mindestens 5 Zeichen lang sein und eine konkrete Urkunde/Vertragsstelle benennen."
    );
  }

  // Verifying User ID
  if (!input.verifyingUserId || typeof input.verifyingUserId !== "string" || !input.verifyingUserId.trim()) {
    errors.push("Prüfer-ID (verifyingUserId) ist erforderlich.");
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    validatedInput: {
      clientId: input.clientId!.trim(),
      clientContractId: cleanContractId,
      qualification: input.qualification!.trim(),
      hourlyRateInCents: input.hourlyRateInCents!,
      effectiveFrom: input.effectiveFrom!,
      effectiveTo: cleanEffectiveTo,
      sourceType: input.sourceType as DocumentedPriceSourceType,
      sourceReference: input.sourceReference!.trim(),
      verifyingUserId: input.verifyingUserId!.trim(),
    },
  };
}

/**
 * Formats cents into German currency string (e.g. 3500 cents -> "35,00 €").
 */
export function formatCentsGermanEur(cents: number): string {
  const eur = cents / 100;
  return `${eur.toFixed(2).replace(".", ",")} €`;
}

/**
 * Checks if two date intervals [aStart, aEnd] and [bStart, bEnd] overlap.
 * Null end date denotes infinity ('9999-12-31').
 */
export function doIntervalsOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null
): boolean {
  const maxEndA = aEnd ?? "9999-12-31";
  const maxEndB = bEnd ?? "9999-12-31";
  return aStart <= maxEndB && bStart <= maxEndA;
}

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
      message: `Benutzer "${user.email}" besitzt keine Administrator-Berechtigung (Rolle: "${user.role}"). Nur Administratoren dürfen Preisversionen erfassen oder prüfen.`,
    };
  }

  return { success: true, user };
}

/**
 * Generates an immutable, human-auditable preview summary for a documented price version.
 */
export async function previewClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  input: unknown;
  actorUserId: string;
}): Promise<AdminServiceResult<RateVersionPreviewSummary>> {
  const { prisma, input, actorUserId } = params;

  // 1. Authorization check for actor
  const actorCheck = await verifyAdminUser(prisma, actorUserId);
  if (!actorCheck.success) {
    return actorCheck;
  }

  // 2. Syntactic validation of input
  const valResult = validateClientHourlyRateInput(input);
  if (!valResult.isValid || !valResult.validatedInput) {
    return {
      success: false,
      code: "INVALID_RATE_INPUT",
      message: "Ungültige Eingabedaten für Preisversion.",
      details: { errors: valResult.errors },
    };
  }

  const validated = valResult.validatedInput;

  // 3. Verifier user existence & privilege check
  const verifierCheck = await verifyAdminUser(prisma, validated.verifyingUserId);
  if (!verifierCheck.success) {
    return verifierCheck;
  }
  const verifier = verifierCheck.user;

  // 4. Verify Client existence
  const client = await prisma.client.findUnique({
    where: { id: validated.clientId },
    select: { id: true, name: true, shortCode: true },
  });

  if (!client) {
    return {
      success: false,
      code: "CLIENT_NOT_FOUND",
      message: `Kunde mit ID "${validated.clientId}" wurde nicht gefunden.`,
    };
  }

  // 5. Verify Contract existence and client parity (if contract-scoped)
  let contractPeriod: string | null = null;
  if (validated.clientContractId) {
    const contract = await prisma.clientContract.findUnique({
      where: { id: validated.clientContractId },
      select: { id: true, clientId: true, period: true, status: true },
    });

    if (!contract) {
      return {
        success: false,
        code: "CONTRACT_NOT_FOUND",
        message: `Vertrag mit ID "${validated.clientContractId}" wurde nicht gefunden.`,
      };
    }

    if (contract.clientId !== validated.clientId) {
      return {
        success: false,
        code: "CONTRACT_CLIENT_MISMATCH",
        message: `Vertrag "${validated.clientContractId}" gehört zu Kunde "${contract.clientId}", nicht zu dem angegebenen Kunden "${validated.clientId}".`,
      };
    }
    contractPeriod = contract.period ?? null;
  }

  // 6. Check for overlaps and determine next version number
  const normalizedQual = validated.qualification.trim().toLowerCase();
  const existingRates = await prisma.clientHourlyRateVersion.findMany({
    where: {
      clientId: validated.clientId,
      clientContractId: validated.clientContractId,
      qualification: { equals: normalizedQual, mode: "insensitive" },
    },
    orderBy: { rateVersion: "desc" },
  });

  // Check physical interval overlap against all existing rates in this scope
  for (const existing of existingRates) {
    const exFrom = toIsoDay(existing.effectiveFrom);
    const exTo = toIsoDay(existing.effectiveTo);
    if (exFrom) {
      if (doIntervalsOverlap(validated.effectiveFrom, validated.effectiveTo ?? null, exFrom, exTo)) {
        return {
          success: false,
          code: "OVERLAPPING_VALIDITY_INTERVAL",
          message: `Gültigkeitszeitraum [${validated.effectiveFrom} .. ${validated.effectiveTo ?? "unbefristet"}] überschneidet sich mit bestehender Preisversion "${existing.id}" (v${existing.rateVersion}: [${exFrom} .. ${exTo ?? "unbefristet"}]).`,
          details: {
            conflictingRateId: existing.id,
            conflictingVersion: existing.rateVersion,
            conflictingFrom: exFrom,
            conflictingTo: exTo,
          },
        };
      }
    }
  }

  const nextRateVersion =
    existingRates.length > 0 && typeof existingRates[0].rateVersion === "number"
      ? existingRates[0].rateVersion + 1
      : 1;

  // 7. Compute canonical hash
  const canonicalHash = computeRateVersionCanonicalHash({
    clientId: validated.clientId,
    clientContractId: validated.clientContractId ?? null,
    rateVersion: nextRateVersion,
    qualification: validated.qualification,
    hourlyRateInCents: validated.hourlyRateInCents,
    effectiveFrom: validated.effectiveFrom,
    effectiveTo: validated.effectiveTo ?? null,
    sourceType: validated.sourceType,
    sourceReference: validated.sourceReference,
  });

  const verifiedAtIso = new Date().toISOString();

  const previewSummary: RateVersionPreviewSummary = {
    isValid: true,
    scope: {
      clientId: client.id,
      clientName: client.name,
      clientContractId: validated.clientContractId ?? null,
      contractPeriod,
      isGeneralScope: (validated.clientContractId ?? null) === null,
    },
    rateTerms: {
      qualification: validated.qualification,
      normalizedQualification: normalizedQual,
      hourlyRateInCents: validated.hourlyRateInCents,
      hourlyRateFormattedEur: formatCentsGermanEur(validated.hourlyRateInCents),
      effectiveFrom: validated.effectiveFrom,
      effectiveTo: validated.effectiveTo ?? null,
      rateVersion: nextRateVersion,
    },
    provenance: {
      sourceType: validated.sourceType,
      sourceReference: validated.sourceReference,
      verifyingUser: {
        id: verifier.id,
        fullName: verifier.fullName,
        email: verifier.email,
        role: verifier.role,
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
 * Creates, verifies, and permanently freezes a documented client hourly rate version.
 */
export async function createAndFreezeClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  input: unknown;
  actorUserId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<AdminServiceResult<any>> {
  const { prisma, input, actorUserId } = params;

  // Run preview validation first
  const preview = await previewClientHourlyRate({ prisma, input, actorUserId });
  if (!preview.success) {
    return preview;
  }

  const p = preview.data;

  // Insert frozen rate record into database
  const createdRecord = await prisma.clientHourlyRateVersion.create({
    data: {
      clientId: p.scope.clientId,
      clientContractId: p.scope.clientContractId,
      rateVersion: p.rateTerms.rateVersion,
      qualification: p.rateTerms.qualification,
      hourlyRateInCents: p.rateTerms.hourlyRateInCents,
      effectiveFrom: new Date(p.rateTerms.effectiveFrom),
      effectiveTo: p.rateTerms.effectiveTo ? new Date(p.rateTerms.effectiveTo) : null,
      sourceType: p.provenance.sourceType,
      sourceReference: p.provenance.sourceReference,
      isFrozen: true,
      frozenAt: new Date(),
      frozenHash: p.integrity.canonicalHash,
      verifiedByUserId: p.provenance.verifyingUser.id,
      verifiedAt: new Date(p.provenance.verifiedAtIso),
    },
  });

  return { success: true, data: createdRecord };
}

/**
 * Supersedes a documented rate with a new successor version.
 * Immutability policy:
 * - The existing frozen record CANNOT be modified or deleted.
 * - The new version must target the same scope (client, contract, qualification).
 * - The new version must have effectiveFrom >= existing.effectiveTo + 1 day (or non-overlapping).
 */
export async function supersedeClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  existingRateId: string;
  newRateInput: unknown;
  actorUserId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<AdminServiceResult<any>> {
  const { prisma, existingRateId, newRateInput, actorUserId } = params;

  // 1. Authorization check
  const actorCheck = await verifyAdminUser(prisma, actorUserId);
  if (!actorCheck.success) {
    return actorCheck;
  }

  // 2. Fetch existing rate
  const existing = await prisma.clientHourlyRateVersion.findUnique({
    where: { id: existingRateId },
  });

  if (!existing) {
    return {
      success: false,
      code: "RATE_NOT_FOUND",
      message: `Bestehende Preisversion "${existingRateId}" wurde nicht gefunden.`,
    };
  }

  // 3. Ensure input matches existing scope
  const valResult = validateClientHourlyRateInput(newRateInput);
  if (!valResult.isValid || !valResult.validatedInput) {
    return {
      success: false,
      code: "INVALID_RATE_INPUT",
      message: "Ungültige Eingabedaten für Nachfolge-Preisversion.",
      details: { errors: valResult.errors },
    };
  }

  const validated = valResult.validatedInput;

  if (validated.clientId !== existing.clientId) {
    return {
      success: false,
      code: "SCOPE_MISMATCH",
      message: `Kunde der neuen Version ("${validated.clientId}") weicht vom bestehenden Kunden ("${existing.clientId}") ab.`,
    };
  }

  if (
    (validated.clientContractId ?? null) !== (existing.clientContractId ?? null)
  ) {
    return {
      success: false,
      code: "SCOPE_MISMATCH",
      message: `Vertragsbereich der neuen Version ("${validated.clientContractId}") weicht vom bestehenden Bereich ("${existing.clientContractId}") ab.`,
    };
  }

  if (
    validated.qualification.trim().toLowerCase() !==
    existing.qualification.trim().toLowerCase()
  ) {
    return {
      success: false,
      code: "SCOPE_MISMATCH",
      message: `Qualifikation der neuen Version ("${validated.qualification}") weicht von bestehender Qualifikation ("${existing.qualification}") ab.`,
    };
  }

  // Create and freeze the new rate version (which enforces non-overlapping and increments rateVersion)
  return createAndFreezeClientHourlyRate({ prisma, input: validated, actorUserId });
}

/**
 * Attempting to update a frozen rate record is rejected at application and database level.
 */
export async function updateClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  rateId: string;
  actorUserId: string;
}): Promise<AdminServiceResult<never>> {
  const { prisma, rateId, actorUserId } = params;

  const actorCheck = await verifyAdminUser(prisma, actorUserId);
  if (!actorCheck.success) {
    return actorCheck;
  }

  const existing = await prisma.clientHourlyRateVersion.findUnique({
    where: { id: rateId },
  });

  if (!existing) {
    return {
      success: false,
      code: "RATE_NOT_FOUND",
      message: `Preisversion "${rateId}" wurde nicht gefunden.`,
    };
  }

  if (existing.isFrozen === true) {
    return {
      success: false,
      code: "FROZEN_RECORD_IMMUTABLE",
      message: `Die Preisversion "${rateId}" ist dauerhaft eingefroren und unveränderlich. Änderungen sind verboten; erstellen Sie eine Nachfolgeversion (Supersede).`,
    };
  }

  return {
    success: false,
    code: "UNSUPPORTED_OPERATION",
    message: "Direkte Modifikation von Preisversionen wird nicht unterstützt.",
  };
}

/**
 * Attempting to delete a frozen rate record is rejected at application and database level.
 */
export async function deleteClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  rateId: string;
  actorUserId: string;
}): Promise<AdminServiceResult<never>> {
  const { prisma, rateId, actorUserId } = params;

  const actorCheck = await verifyAdminUser(prisma, actorUserId);
  if (!actorCheck.success) {
    return actorCheck;
  }

  const existing = await prisma.clientHourlyRateVersion.findUnique({
    where: { id: rateId },
  });

  if (!existing) {
    return {
      success: false,
      code: "RATE_NOT_FOUND",
      message: `Preisversion "${rateId}" wurde nicht gefunden.`,
    };
  }

  if (existing.isFrozen === true) {
    return {
      success: false,
      code: "FROZEN_RECORD_IMMUTABLE",
      message: `Die Preisversion "${rateId}" ist dauerhaft eingefroren und unveränderlich. Löschen ist verboten.`,
    };
  }

  return {
    success: false,
    code: "UNSUPPORTED_OPERATION",
    message: "Löschen von Preisversionen wird nicht unterstützt.",
  };
}
