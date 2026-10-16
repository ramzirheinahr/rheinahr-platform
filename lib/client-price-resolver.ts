/**
 * Dated and Verifiable Client/Facility Price Resolver (Phase 5b-1)
 * RheinAhr Dienstleistungen GmbH - Invoice Engine Modernization
 *
 * Guarantees:
 * 1. Verifiable & Dated Rates:
 *    Resolves immutable, dated price versions from ClientHourlyRateVersion.
 * 2. Strict Non-Fabrication & Zero Live Fallback:
 *    Never falls back to unversioned, mutable Client.hourlyRates or HOURLY_RATES defaults.
 * 3. Contract-specific prices take precedence. When none exists, a frozen,
 *    administrator-confirmed client-profile setting may cover that client's
 *    contract-bound shifts; other general records may not.
 * 4. Ambiguity & Overlap Detection:
 *    Multiple active price versions for the same client, qualification, and contract scope
 *    fail closed with AMBIGUOUS_PRICE_OVERLAP.
 * 5. Midnight Rollover Verification:
 *    If a shift spans into the next calendar day with billable minutes (endTotalMin > 0),
 *    the price version must consistently cover both days without mid-shift expiration or conflict.
 */

import { createHash } from "node:crypto";
import type { PriceVersionRecord } from "./invoice-v2-draft-service";
import { hashClientPricingRateChange } from "./client-pricing-rate-change";

export type ResolveClientPriceVersionParams = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  clientId: string;
  qualification: string;
  shiftDateIso: string;
  contractId?: string | null;
  spansIntoNextDay?: boolean;
  endShiftDateIso?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadedRates?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadedDefaultRates?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preloadedRateChanges?: any[];
};

export type ResolveClientPriceVersionSuccess = {
  status: "resolved";
  priceRecord: PriceVersionRecord;
};

export type ResolveClientPriceVersionError = {
  status: "unresolved";
  code: "PRICE_UNRESOLVED" | "AMBIGUOUS_PRICE_OVERLAP" | "PRICE_NOT_FROZEN";
  message: string;
  diagnostics?: Record<string, unknown>;
};

export type ResolveClientPriceVersionResult =
  | ResolveClientPriceVersionSuccess
  | ResolveClientPriceVersionError;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toIsoDay(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = pad2(d.getUTCMonth() + 1);
    const day = pad2(d.getUTCDate());
    return `${y}-${m}-${day}`;
  }
  if (typeof d === "string") {
    const trimmed = d.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }
  return null;
}

export function isValidIsoDateString(d: unknown): boolean {
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

/**
 * Computes an immutable canonical SHA-256 hash over the rate version terms.
 */
export function computeRateVersionCanonicalHash(terms: {
  clientId: string;
  clientContractId: string | null;
  rateVersion: number;
  qualification: string;
  hourlyRateInCents: number;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD
  sourceType: string;
  sourceReference: string;
  sourceDocumentUrl?: string | null;
}): string {
  const canonicalObject = {
    clientId: terms.clientId,
    clientContractId: terms.clientContractId || null,
    effectiveFrom: terms.effectiveFrom,
    effectiveTo: terms.effectiveTo || null,
    hourlyRateInCents: terms.hourlyRateInCents,
    qualification: terms.qualification.trim().toLowerCase(),
    rateVersion: terms.rateVersion,
    sourceDocumentUrl: terms.sourceDocumentUrl ? terms.sourceDocumentUrl.trim() : null,
    sourceReference: terms.sourceReference.trim(),
    sourceType: terms.sourceType,
  };
  return createHash("sha256").update(JSON.stringify(canonicalObject)).digest("hex");
}

/**
 * Server-side resolver for verified, dated client hourly rates from ClientHourlyRateVersion.
 */
export async function resolveClientPriceVersion(
  params: ResolveClientPriceVersionParams
): Promise<ResolveClientPriceVersionResult> {
  const { prisma, clientId, qualification, shiftDateIso, contractId, spansIntoNextDay, endShiftDateIso, preloadedRates, preloadedDefaultRates, preloadedRateChanges } =
    params;

  if (!isValidIsoDateString(shiftDateIso)) {
    return {
      status: "unresolved",
      code: "PRICE_UNRESOLVED",
      message: `Ungültiges Schichtdatum ("${shiftDateIso}"). Erwartet wird ein valides ISO-Datum (YYYY-MM-DD).`,
      diagnostics: { clientId, qualification, shiftDateIso },
    };
  }

  const cleanClientId = clientId.trim();
  const cleanQual = qualification.trim().toLowerCase();
  const cleanContractId = contractId?.trim() || null;

  const queryRates = async (
    targetContractId: string | null,
    sourceTypeSettingOnly: boolean,
    targetDateIso: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> => {
    if (preloadedRates) {
      const d = new Date(targetDateIso);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return preloadedRates.filter((r: any) => {
        if (r.clientId !== cleanClientId) return false;
        if (r.clientContractId !== targetContractId) return false;
        if (sourceTypeSettingOnly && r.sourceType !== "setting") return false;
        if (r.qualification.trim().toLowerCase() !== cleanQual) return false;
        const from = r.effectiveFrom instanceof Date ? r.effectiveFrom : new Date(r.effectiveFrom);
        if (from > d) return false;
        if (r.effectiveTo) {
          const to = r.effectiveTo instanceof Date ? r.effectiveTo : new Date(r.effectiveTo);
          if (to < d) return false;
        }
        return true;
      });
    }

    return await prisma.clientHourlyRateVersion.findMany({
      where: {
        clientId: cleanClientId,
        clientContractId: targetContractId,
        ...(sourceTypeSettingOnly ? { sourceType: "setting" } : {}),
        qualification: { equals: cleanQual, mode: "insensitive" },
        effectiveFrom: { lte: new Date(targetDateIso) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date(targetDateIso) } },
        ],
      },
      include: {
        verifiedByUser: { select: { id: true, fullName: true, email: true } },
      },
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestRateChange = async (dateIso: string): Promise<any | null> => {
    const all = preloadedRateChanges ?? (prisma.clientPricingRateChange
      ? await prisma.clientPricingRateChange.findMany({ where: {
          clientId: cleanClientId, qualificationCode: cleanQual,
          effectiveFrom: { lte: new Date(`${dateIso}T00:00:00.000Z`) },
        } }) : []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return all.filter((item: any) => item.clientId === cleanClientId &&
        item.qualificationCode === cleanQual && toIsoDay(item.effectiveFrom)! <= dateIso)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort((a: any, b: any) => toIsoDay(b.effectiveFrom)!.localeCompare(toIsoDay(a.effectiveFrom)!) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id))[0] ?? null;
  };

  try {
    let matchingRates = await queryRates(cleanContractId, false, shiftDateIso);
    // A signed contract-specific rate wins. A later explicit edit in the
    // Vergütung editor supersedes an older general setting without mutating it.
    const hasContractRate = Boolean(cleanContractId && matchingRates.length);
    const rateChange = hasContractRate ? null : await latestRateChange(shiftDateIso);
    if (rateChange) {
      const terms = {
        clientId: rateChange.clientId, qualificationCode: rateChange.qualificationCode,
        hourlyRateInCents: rateChange.hourlyRateInCents,
        effectiveFrom: toIsoDay(rateChange.effectiveFrom)!,
        verifiedByUserId: rateChange.verifiedByUserId,
        sourceReference: rateChange.sourceReference,
      };
      if (!terms.effectiveFrom || rateChange.frozenHash !== hashClientPricingRateChange(terms) ||
        !terms.verifiedByUserId || !terms.sourceReference ||
        (terms.hourlyRateInCents !== null && (!Number.isSafeInteger(terms.hourlyRateInCents) || terms.hourlyRateInCents <= 0))) {
        return { status: "unresolved", code: "PRICE_UNRESOLVED", message: `Beschädigte Kundenpreisänderung für "${qualification}".` };
      }
      if (spansIntoNextDay && endShiftDateIso && endShiftDateIso !== shiftDateIso &&
        ((await latestRateChange(endShiftDateIso))?.id !== rateChange.id ||
          (cleanContractId && (await queryRates(cleanContractId, false, endShiftDateIso)).length > 0))) {
        return { status: "unresolved", code: "PRICE_UNRESOLVED", message: `Während der Nachtschicht ändert sich der Kundensatz für "${qualification}".` };
      }
      if (terms.hourlyRateInCents !== null) {
        return { status: "resolved", priceRecord: {
          priceVersionId: rateChange.id, clientId: cleanClientId, qualification: cleanQual,
          hourlyRateInCents: terms.hourlyRateInCents, effectiveFrom: terms.effectiveFrom,
          effectiveTo: null, contractId: null, sourceType: "setting",
          sourceReference: terms.sourceReference,
          verifiedAt: rateChange.createdAt instanceof Date ? rateChange.createdAt.toISOString() : String(rateChange.createdAt),
          verifiedBy: terms.verifiedByUserId,
        } };
      }
      // Explicitly blank means inherit the dated platform default, even when
      // an older immutable customer setting still spans this date.
      matchingRates = [];
    }

    // The existing client profile is client-wide. Its explicitly approved,
    // immutable V2 copy can cover a contract-bound shift only when no
    // contract-specific version applies on that date. Never use raw profile
    // values or an unverified general "contract" rate as a fallback.
    let usingClientWideSetting = false;
    if (matchingRates.length === 0 && cleanContractId && !rateChange) {
      matchingRates = await queryRates(null, true, shiftDateIso);
      usingClientWideSetting = true;
    }

    if (matchingRates.length > 1) {
      return {
        status: "unresolved",
        code: "AMBIGUOUS_PRICE_OVERLAP",
        message: `Mehrdeutige Preisversionen für Kunde "${cleanClientId}", Qualifikation "${qualification}" zum Datum "${shiftDateIso}": Es wurden ${matchingRates.length} aktive Preisversionen gefunden (${matchingRates.map((r: { id: string }) => r.id).join(", ")}).`,
        diagnostics: {
          clientId: cleanClientId,
          qualification,
          shiftDateIso,
          contractId: cleanContractId,
          matchingPriceVersionIds: matchingRates.map((r: { id: string }) => r.id),
        },
      };
    }

    if (matchingRates.length === 0) {
      // A platform default is a dated, hashed price version. Never use the
      // mutable catalog price or the legacy HOURLY_RATES map in V2 invoices.
      const defaultVersions = preloadedDefaultRates ??
        (prisma.qualificationDefaultRateVersion
          ? await prisma.qualificationDefaultRateVersion.findMany({ where: { qualificationCode: cleanQual } })
          : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pickDefault = (dateIso: string): any | null => defaultVersions
        .filter((version: { qualificationCode: string; effectiveFrom: Date | string }) =>
          version.qualificationCode === cleanQual && toIsoDay(version.effectiveFrom)! <= dateIso)
        .sort((a: { effectiveFrom: Date | string; version: number }, b: { effectiveFrom: Date | string; version: number }) =>
          toIsoDay(b.effectiveFrom)!.localeCompare(toIsoDay(a.effectiveFrom)!) || b.version - a.version)[0] ?? null;
      const defaultRecord = pickDefault(shiftDateIso);
      if (defaultRecord) {
        const fromIso = toIsoDay(defaultRecord.effectiveFrom);
        const terms = {
          qualificationCode: defaultRecord.qualificationCode,
          version: defaultRecord.version,
          hourlyRateInCents: defaultRecord.hourlyRateInCents,
          effectiveFrom: fromIso,
          sourceReference: defaultRecord.sourceReference,
          verifiedByUserId: defaultRecord.verifiedByUserId,
        };
        const expectedHash = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
        const verifiedAt = defaultRecord.verifiedAt instanceof Date
          ? defaultRecord.verifiedAt.toISOString() : String(defaultRecord.verifiedAt ?? "");
        if (!fromIso || defaultRecord.frozenHash !== expectedHash ||
          !Number.isSafeInteger(defaultRecord.hourlyRateInCents) || defaultRecord.hourlyRateInCents <= 0 ||
          !defaultRecord.verifiedByUserId || !defaultRecord.sourceReference ||
          Number.isNaN(Date.parse(verifiedAt))) {
          return { status: "unresolved", code: "PRICE_UNRESOLVED", message: `Ungültige oder beschädigte Standard-Preisversion für Qualifikation "${qualification}".`, diagnostics: { qualification, shiftDateIso } };
        }
        if (spansIntoNextDay && endShiftDateIso && endShiftDateIso !== shiftDateIso) {
          if (pickDefault(endShiftDateIso)?.id !== defaultRecord.id ||
            (!rateChange && (await queryRates(cleanContractId, false, endShiftDateIso)).length > 0) ||
            (!rateChange && cleanContractId && (await queryRates(null, true, endShiftDateIso)).length > 0)) {
            return { status: "unresolved", code: "PRICE_UNRESOLVED", message: `Während der Nachtschicht ändert sich die Preisversion für "${qualification}".`, diagnostics: { qualification, shiftDateIso, endShiftDateIso } };
          }
        }
        return { status: "resolved", priceRecord: {
          priceVersionId: defaultRecord.id,
          clientId: cleanClientId,
          qualification: cleanQual,
          hourlyRateInCents: defaultRecord.hourlyRateInCents,
          effectiveFrom: fromIso,
          effectiveTo: null,
          contractId: null,
          sourceType: "setting",
          sourceReference: defaultRecord.sourceReference,
          verifiedAt,
          verifiedBy: defaultRecord.verifiedByUserId,
        } };
      }
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Keine gültige, datierte Preisversion für Kunde "${cleanClientId}", Qualifikation "${qualification}" zum Datum "${shiftDateIso}"${cleanContractId ? ` und Vertrag "${cleanContractId}"` : ""} gefunden. Ein Fallback auf unversionierte Live-Kundenpreise ist unzulässig.`,
        diagnostics: {
          clientId: cleanClientId,
          qualification,
          shiftDateIso,
          contractId: cleanContractId,
        },
      };
    }

    const record = matchingRates[0];

    if (usingClientWideSetting && (record.clientContractId !== null || record.sourceType !== "setting")) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Für Vertrag "${cleanContractId}" ist diese allgemeine Preisversion keine bestätigte Kundenprofileinstellung.`,
        diagnostics: { clientId: cleanClientId, qualification, shiftDateIso },
      };
    }

    // Check frozen status
    if (record.isFrozen !== true) {
      return {
        status: "unresolved",
        code: "PRICE_NOT_FROZEN",
        message: `Die Preisversion "${record.id}" für Kunde "${cleanClientId}" ist nicht dauerhaft eingefroren (isFrozen !== true).`,
        diagnostics: {
          priceVersionId: record.id,
          clientId: cleanClientId,
          isFrozen: record.isFrozen,
        },
      };
    }

    const fromIso = toIsoDay(record.effectiveFrom);
    const toIso = toIsoDay(record.effectiveTo);

    if (!fromIso || !isValidIsoDateString(fromIso) || (record.effectiveTo && (!toIso || !isValidIsoDateString(toIso)))) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${record.id}" enthält ungültige Datumsformate für den Gültigkeitszeitraum.`,
        diagnostics: {
          priceVersionId: record.id,
          effectiveFrom: record.effectiveFrom,
          effectiveTo: record.effectiveTo,
        },
      };
    }

    if (toIso && fromIso > toIso) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Invertierter Gültigkeitszeitraum in Preisversion "${record.id}": effectiveFrom (${fromIso}) liegt nach effectiveTo (${toIso}).`,
        diagnostics: {
          priceVersionId: record.id,
          effectiveFrom: fromIso,
          effectiveTo: toIso,
        },
      };
    }

    // Check verification metadata
    const verifiedBy =
      record.verifiedByUser?.fullName ||
      record.verifiedByUserId ||
      record.verifiedByUser?.email ||
      null;

    const verifiedAtStr =
      record.verifiedAt instanceof Date
        ? record.verifiedAt.toISOString()
        : typeof record.verifiedAt === "string"
        ? record.verifiedAt
        : null;

    if (
      !verifiedBy ||
      !verifiedAtStr ||
      isNaN(Date.parse(verifiedAtStr)) ||
      !record.sourceReference ||
      !record.sourceReference.trim()
    ) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Die Preisversion "${record.id}" verfügt über unzureichende oder unbestätigte Verifizierungs-Metadaten (verifiedBy, verifiedAt oder sourceReference fehlen oder sind ungültig).`,
        diagnostics: {
          priceVersionId: record.id,
          verifiedBy,
          verifiedAt: verifiedAtStr,
          sourceReference: record.sourceReference,
        },
      };
    }

    // Anti-tampering check: calculate canonical hash and compare
    const expectedHash = computeRateVersionCanonicalHash({
      clientId: record.clientId,
      clientContractId: record.clientContractId,
      rateVersion: record.rateVersion ?? 1,
      qualification: record.qualification,
      hourlyRateInCents: record.hourlyRateInCents,
      effectiveFrom: fromIso,
      effectiveTo: toIso,
      sourceType: record.sourceType ?? "contract",
      sourceReference: record.sourceReference,
      sourceDocumentUrl: record.sourceDocumentUrl ?? null,
    });

    if (record.frozenHash !== expectedHash) {
      return {
        status: "unresolved",
        code: "PRICE_UNRESOLVED",
        message: `Integritätsverletzung in Preisversion "${record.id}": Der Prüfsummen-Hash stimmt nicht mit den Daten überein (Manipulation erkannt).`,
        diagnostics: {
          priceVersionId: record.id,
          storedHash: record.frozenHash,
          calculatedHash: expectedHash,
        },
      };
    }

    // Midnight rollover verification (when shift actually has minutes on Day 2)
    if (spansIntoNextDay && endShiftDateIso && endShiftDateIso !== shiftDateIso) {
      if (toIso && toIso < endShiftDateIso) {
        return {
          status: "unresolved",
          code: "PRICE_UNRESOLVED",
          message: `Die Preisversion "${record.id}" läuft während der Nachtschicht ab (gültig bis ${toIso}, Schichtende am ${endShiftDateIso}).`,
          diagnostics: {
            priceVersionId: record.id,
            clientId: cleanClientId,
            shiftDateIso,
            endShiftDateIso,
            effectiveTo: toIso,
          },
        };
      }

      // Check for conflicting or overlapping rate records at shift end
      const matchingRatesEnd = await queryRates(
        usingClientWideSetting ? null : cleanContractId,
        usingClientWideSetting,
        endShiftDateIso
      );

      if (matchingRatesEnd.length > 1) {
        return {
          status: "unresolved",
          code: "AMBIGUOUS_PRICE_OVERLAP",
          message: `Mehrdeutige Preisversionen für Kunde "${cleanClientId}" zum Datum des Schichtendes "${endShiftDateIso}": Es wurden ${matchingRatesEnd.length} aktive Preisversionen gefunden.`,
          diagnostics: {
            clientId: cleanClientId,
            shiftDateIso,
            endShiftDateIso,
            matchingPriceVersionIds: matchingRatesEnd.map((r: { id: string }) => r.id),
          },
        };
      }

      if (matchingRatesEnd.length === 0 || matchingRatesEnd[0].id !== record.id) {
        return {
          status: "unresolved",
          code: "PRICE_UNRESOLVED",
          message: `Die Preisversion für Kunde "${cleanClientId}" deckt das Schichtende am "${endShiftDateIso}" nicht konsistent durch dieselbe Preisversion ab.`,
          diagnostics: {
            clientId: cleanClientId,
            shiftDateIso,
            endShiftDateIso,
          },
        };
      }

      if (usingClientWideSetting) {
        const contractRatesAtEnd = await queryRates(cleanContractId, false, endShiftDateIso);
        if (contractRatesAtEnd.length > 0) {
          return {
            status: "unresolved",
            code: "PRICE_UNRESOLVED",
            message: `Während der Nachtschicht beginnt eine vertragsbezogene Preisversion am ${endShiftDateIso}.`,
            diagnostics: { clientId: cleanClientId, shiftDateIso, endShiftDateIso },
          };
        }
      }
    }

    const priceRecord: PriceVersionRecord = {
      priceVersionId: record.id,
      clientId: record.clientId,
      qualification: record.qualification,
      hourlyRateInCents: record.hourlyRateInCents,
      effectiveFrom: fromIso,
      effectiveTo: toIso,
      contractId: record.clientContractId,
      sourceType: record.sourceType,
      sourceReference: record.sourceReference,
      sourceDocumentUrl: record.sourceDocumentUrl ?? null,
      verifiedAt: verifiedAtStr,
      verifiedBy,
    };

    return {
      status: "resolved",
      priceRecord,
    };
  } catch (err) {
    return {
      status: "unresolved",
      code: "PRICE_UNRESOLVED",
      message: `Datenbankfehler beim Auflösen der Preisversion: ${err instanceof Error ? err.message : String(err)}`,
      diagnostics: {
        clientId: cleanClientId,
        qualification,
        shiftDateIso,
        contractId: cleanContractId,
        details: err,
      },
    };
  }
}
