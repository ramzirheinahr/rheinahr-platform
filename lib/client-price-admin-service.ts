/**
 * Restricted Administrative Ingestion and Review Service for Documented Client Hourly Rates (Phase 5b-2a)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Core Guarantees:
 * 1. Strict Contractual Provenance & Zero Automatic Extraction:
 *    Rates can ONLY be ingested from authentic signed contracts, amendments, framework agreements,
 *    or judicial settlements. Automatic extraction from unversioned live fields (e.g. Client.hourlyRates)
 *    is strictly prohibited and rejected.
 * 2. Mandatory Documentary Backing & Verifier Proof:
 *    Every rate version must be backed by an active, signed contract (for contract scopes) or a signed
 *    facility framework agreement / verified archived document URL (for general scopes).
 *    Free-text references without documentary proof are strictly rejected.
 *    The verifier identity must match the authenticated acting administrator session.
 * 3. Immutable Pre-Freeze Verification & Canonical Hash Binding:
 *    Provides a structured, human-auditable preview of all rate terms, scope, validity interval,
 *    and source references before freezing. Committing/freezing requires passing the exact previewed
 *    canonical SHA-256 hash; any discrepancy or post-preview modification is rejected.
 * 4. Closed Interval Policy (Addressing Open-Ended Overlaps):
 *    All rate versions must have a definitive effectiveTo date matching the contractual or tariff period.
 *    Indefinite intervals (effectiveTo = null) are strictly prohibited to prevent unresolvable physical
 *    exclusion conflicts with future successor versions while preserving frozen immutability.
 * 5. Total Immutability Post-Freeze:
 *    Once frozen (isFrozen = true), price amount, contractual scope, qualification, validity interval,
 *    and source references cannot be modified or deleted. Corrections must be issued as a new rate version
 *    (rateVersion = old + 1) starting strictly after the prior version's effectiveTo.
 *
 * Trust Boundary & Server Architecture:
 * - This service represents an internal, domain-level administrative engine.
 * - In server actions / API endpoints, actorUserId must be derived directly from the verified cryptographic
 *   session token (e.g. Supabase Auth / NextAuth / IronSession).
 * - This service documents and cryptographically locks human administrative verification; it does not claim
 *   magical automated interpretation of unstructured document contents.
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
  effectiveTo: string; // YYYY-MM-DD (mandatory closed interval)
  sourceType: DocumentedPriceSourceType;
  sourceReference: string;
  sourceDocumentUrl?: string | null;
  verifyingUserId: string;
};

export type RateVersionPreviewSummary = {
  isValid: boolean;
  scope: {
    clientId: string;
    facilityName: string;
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
    effectiveTo: string;
    rateVersion: number;
  };
  provenance: {
    sourceType: DocumentedPriceSourceType;
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

  // Effective To (Mandatory closed interval policy to prevent unresolvable overlap with successor versions)
  let cleanEffectiveTo: string | null = null;
  if (!input.effectiveTo || typeof input.effectiveTo !== "string" || !input.effectiveTo.trim()) {
    errors.push(
      "Ein konkretes Gültigkeitsende (effectiveTo) ist zwingend erforderlich. Unbefristete Zeiträume (effectiveTo = null) sind unzulässig, da eingefrorene Sätze unveränderlich sind und eine spätere Nachfolgeversion durch den Ausschluss-Constraint physisch blockiert würde. Bitte erfassen Sie das vertraglich vereinbarte Laufzeitende (z. B. zum Jahresende oder Vertragsablauf)."
    );
  } else if (!isValidIsoDateString(input.effectiveTo)) {
    errors.push(
      `Gültig-Bis-Datum (effectiveTo: "${input.effectiveTo}") ist ungültig. Erwartet wird ein valides ISO-Datum (YYYY-MM-DD).`
    );
  } else {
    cleanEffectiveTo = input.effectiveTo.trim();
    const year = Number(cleanEffectiveTo.slice(0, 4));
    if (year < 2000 || year > 2100) {
      errors.push(`Gültig-Bis-Datum ("${cleanEffectiveTo}") liegt außerhalb des zulässigen Bereichs (2000–2100).`);
    }
    if (input.effectiveFrom && isValidIsoDateString(input.effectiveFrom)) {
      if (input.effectiveFrom > cleanEffectiveTo) {
        errors.push(
          `Invertierter Gültigkeitszeitraum: effectiveFrom ("${input.effectiveFrom}") liegt nach effectiveTo ("${cleanEffectiveTo}").`
        );
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

  // Source Document URL / Path (optional string or null)
  let cleanSourceDocUrl: string | null = null;
  if (input.sourceDocumentUrl !== undefined && input.sourceDocumentUrl !== null) {
    if (typeof input.sourceDocumentUrl === "string" && input.sourceDocumentUrl.trim()) {
      cleanSourceDocUrl = input.sourceDocumentUrl.trim();
    }
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
      effectiveTo: cleanEffectiveTo!,
      sourceType: input.sourceType as DocumentedPriceSourceType,
      sourceReference: input.sourceReference!.trim(),
      sourceDocumentUrl: cleanSourceDocUrl,
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
  const actor = actorCheck.user;

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

  // 3. Verifier identity binding: Actor must be the verifier (prevent forging another admin's identity)
  if (validated.verifyingUserId !== actorUserId) {
    return {
      success: false,
      code: "FORGED_VERIFIER_IDENTITY",
      message: `Der angemeldete Administrator ("${actor.email}") kann keine Preisversion im Namen eines abweichenden Prüfers ("${validated.verifyingUserId}") verifizieren. Die Prüferidentität muss mit der authentifizierten Sitzung übereinstimmen.`,
    };
  }
  const verifier = actor;

  // 4. Verify Client existence & framework agreement status
  const client = await prisma.client.findUnique({
    where: { id: validated.clientId },
    select: {
      id: true,
      facilityName: true,
      shortCode: true,
      frameworkAgreementSignedAt: true,
      frameworkAgreementUrl: true,
    },
  });

  if (!client) {
    return {
      success: false,
      code: "CLIENT_NOT_FOUND",
      message: `Kunde mit ID "${validated.clientId}" wurde nicht gefunden.`,
    };
  }

  // 5. Documentary backing verification
  let contractPeriod: string | null = null;
  let resolvedDocumentUrl: string | null = null;

  if (validated.sourceType === "court_settlement") {
    return {
      success: false,
      code: "UNSUPPORTED_SOURCE_TYPE",
      message: `Quelltyp "court_settlement" erfordert einen verifizierten Datensatz in der Datenbank und wird derzeit ohne strukturiertes Urkundenregister nicht unterstützt.`,
    };
  }

  if (validated.clientContractId) {
    // Contract-scoped rate: Contract must exist, belong to client, and be active/signed
    const contract = await prisma.clientContract.findUnique({
      where: { id: validated.clientContractId },
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

    if (contract.status !== "signed" || !contract.signedAt || !contract.documentUrl || !contract.documentUrl.trim()) {
      return {
        success: false,
        code: "CONTRACT_NOT_SIGNED_OR_ACTIVE",
        message: `Vertrag "${validated.clientContractId}" ist nicht im Status "signed" (aktueller Status: "${contract.status}") oder verfügt über keine gültige Signatur/Urkunden-URL. Preise dürfen ausschließlich auf Grundlage wirksamer, unterzeichneter Verträge erfasst werden.`,
      };
    }

    const contractDocUrl = contract.documentUrl.trim();

    // If caller provided an explicit sourceDocumentUrl, it must match the verified contract document URL
    if (validated.sourceDocumentUrl && validated.sourceDocumentUrl.trim() !== contractDocUrl) {
      return {
        success: false,
        code: "CONTRACT_DOCUMENT_MISMATCH",
        message: `Der angegebene Dokumentenbeleg ("${validated.sourceDocumentUrl}") weicht von der im Vertrag hinterlegten Urkunde ("${contractDocUrl}") ab. Willkürliche oder abweichende Urkunden-URLs sind unzulässig.`,
      };
    }

    resolvedDocumentUrl = contractDocUrl;
    contractPeriod = contract.period ?? null;
  } else {
    // General scope rate: Facility must have signed framework agreement in database with both signed date and document URL
    const hasSignedDate = Boolean(client.frameworkAgreementSignedAt);
    const hasDocUrl = Boolean(client.frameworkAgreementUrl && client.frameworkAgreementUrl.trim());

    if (!hasSignedDate || !hasDocUrl) {
      return {
        success: false,
        code: "GENERAL_SCOPE_LACKS_DOCUMENTATION",
        message: `Für allgemeine Einrichtungspreise ohne Einzelvertrag muss eine vollständig nachgewiesene Rahmenvereinbarung der Einrichtung in der Datenbank hinterlegt sein (sowohl frameworkAgreementSignedAt als auch frameworkAgreementUrl). Freie Texte oder ungesicherte externe Links ohne gespeichertes Einrichtungsdokument sind als Nachweis unzulässig.`,
      };
    }

    const frameworkDocUrl = client.frameworkAgreementUrl.trim();

    // If caller provided an explicit sourceDocumentUrl, it must match the facility's verified framework agreement URL
    if (validated.sourceDocumentUrl && validated.sourceDocumentUrl.trim() !== frameworkDocUrl) {
      return {
        success: false,
        code: "FRAMEWORK_DOCUMENT_MISMATCH",
        message: `Der angegebene Dokumentenbeleg ("${validated.sourceDocumentUrl}") weicht von der in der Einrichtung hinterlegten Rahmenvereinbarung ("${frameworkDocUrl}") ab. Willkürliche oder abweichende Urkunden-URLs sind unzulässig.`,
      };
    }

    resolvedDocumentUrl = frameworkDocUrl;
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
      if (doIntervalsOverlap(validated.effectiveFrom, validated.effectiveTo, exFrom, exTo)) {
        return {
          success: false,
          code: "OVERLAPPING_VALIDITY_INTERVAL",
          message: `Gültigkeitszeitraum [${validated.effectiveFrom} .. ${validated.effectiveTo}] überschneidet sich mit bestehender Preisversion "${existing.id}" (v${existing.rateVersion}: [${exFrom} .. ${exTo ?? "unbefristet"}]).`,
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

  // 7. Compute canonical hash bound to terms and documentary evidence
  const canonicalHash = computeRateVersionCanonicalHash({
    clientId: validated.clientId,
    clientContractId: validated.clientContractId ?? null,
    rateVersion: nextRateVersion,
    qualification: validated.qualification,
    hourlyRateInCents: validated.hourlyRateInCents,
    effectiveFrom: validated.effectiveFrom,
    effectiveTo: validated.effectiveTo,
    sourceType: validated.sourceType,
    sourceReference: validated.sourceReference,
    sourceDocumentUrl: resolvedDocumentUrl,
  });

  const verifiedAtIso = new Date().toISOString();

  const previewSummary: RateVersionPreviewSummary = {
    isValid: true,
    scope: {
      clientId: client.id,
      facilityName: client.facilityName,
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
      effectiveTo: validated.effectiveTo,
      rateVersion: nextRateVersion,
    },
    provenance: {
      sourceType: validated.sourceType,
      sourceReference: validated.sourceReference,
      sourceDocumentUrl: resolvedDocumentUrl,
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
 * Requires caller to provide the exact previewed canonical hash (expectedPreviewHash)
 * computed during the preview step.
 *
 * NOTE ON CRYPTOGRAPHIC SCOPE & AUDIT GUARANTEE:
 * Recomputed hash matching provides cryptographic proof that the terms and backing document
 * submitted for commit are strictly identical to the terms generated during preview (anti-tampering).
 * A matching recalculated hash alone does not prove that a human visually reviewed or approved
 * the terms; human accountability is established by verifying that the authenticated administrator
 * (actorUserId) explicitly executed the action and is recorded as the verifier with immutable timestamps.
 */
export async function createAndFreezeClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  input: unknown;
  actorUserId: string;
  expectedPreviewHash: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<AdminServiceResult<any>> {
  const { prisma, input, actorUserId, expectedPreviewHash } = params;

  if (!expectedPreviewHash || typeof expectedPreviewHash !== "string" || !expectedPreviewHash.trim()) {
    return {
      success: false,
      code: "MISSING_PREVIEW_HASH",
      message: "Das Einfrieren erfordert die Angabe des zuvor geprüften Vorschau-Hashs (expectedPreviewHash).",
    };
  }

  // Run preview validation
  const preview = await previewClientHourlyRate({ prisma, input, actorUserId });
  if (!preview.success) {
    return preview;
  }

  const p = preview.data;

  // Strict Hash Binding: The terms being committed must strictly match the approved preview hash
  if (p.integrity.canonicalHash !== expectedPreviewHash.trim()) {
    return {
      success: false,
      code: "PREVIEW_HASH_MISMATCH",
      message: `Die zu speichernden Preisdaten stimmen nicht mit dem freigegebenen Vorschau-Hash überein (erwartet: "${expectedPreviewHash}", berechnet: "${p.integrity.canonicalHash}"). Ein Speichern abweichender Daten nach der Prüfung ist verboten.`,
      details: {
        expectedPreviewHash,
        calculatedHash: p.integrity.canonicalHash,
      },
    };
  }

  // Insert frozen rate record into database with locked preview timestamp
  const createdRecord = await prisma.clientHourlyRateVersion.create({
    data: {
      clientId: p.scope.clientId,
      clientContractId: p.scope.clientContractId,
      rateVersion: p.rateTerms.rateVersion,
      qualification: p.rateTerms.qualification,
      hourlyRateInCents: p.rateTerms.hourlyRateInCents,
      effectiveFrom: new Date(p.rateTerms.effectiveFrom),
      effectiveTo: new Date(p.rateTerms.effectiveTo),
      sourceType: p.provenance.sourceType,
      sourceReference: p.provenance.sourceReference,
      sourceDocumentUrl: p.provenance.sourceDocumentUrl,
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
 * Immutability & Succession policy:
 * - The existing frozen record CANNOT be modified or deleted.
 * - The new version must target the same scope (client, contract, qualification).
 * - The new version must start strictly after the existing version's effectiveTo (effectiveFrom > existing.effectiveTo).
 * - Both versions remain closed intervals, preventing overlap while allowing seamless succession.
 */
export async function supersedeClientHourlyRate(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  existingRateId: string;
  newRateInput: unknown;
  actorUserId: string;
  expectedPreviewHash: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<AdminServiceResult<any>> {
  const { prisma, existingRateId, newRateInput, actorUserId, expectedPreviewHash } = params;

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

  const existingTo = toIsoDay(existing.effectiveTo);
  if (existingTo && validated.effectiveFrom <= existingTo) {
    return {
      success: false,
      code: "OVERLAPPING_SUCCESSOR_START",
      message: `Die Nachfolgeversion beginnt am "${validated.effectiveFrom}", liegt jedoch nicht nach dem Gültigkeitsende der Vorversion ("${existingTo}").`,
    };
  }

  // Create and freeze the new rate version
  return createAndFreezeClientHourlyRate({
    prisma,
    input: validated,
    actorUserId,
    expectedPreviewHash,
  });
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
