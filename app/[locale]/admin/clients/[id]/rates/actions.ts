"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import {
  previewClientHourlyRate,
  type RateVersionPreviewSummary,
} from "@/lib/client-price-admin-service";
import {
  previewFacilitySurchargePolicy,
  type FacilitySurchargePolicyPreviewSummary,
} from "@/lib/facility-surcharge-admin-service";
import type { GermanFederalState } from "@/lib/facility-surcharge-policy-template";
import type { SurchargeCombinationRule } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseBillingHolidayCalendar, validateBillingHolidays, type BillingHoliday } from "@/lib/client-billing-holidays";
import { CLIENT_RATE_CHANGE_SOURCE, hashClientPricingRateChange, todayInBerlin } from "@/lib/client-pricing-rate-change";

const optionalPercentage = z.number().finite().min(0).max(200)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Percent precision required")
  .nullable();
const optionalHourlyRate = z.number().finite().gt(0).max(1000)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, "Cent precision required")
  .nullable();
const pricingDraftSchema = z.object({
  clientId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime(),
  surchargeSatPct: optionalPercentage,
  surchargeSunPct: optionalPercentage,
  surchargeHolidayPct: optionalPercentage,
  surchargeNightPct: optionalPercentage,
  nightStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  nightEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  hourlyRates: z.record(z.string().min(2).max(120), optionalHourlyRate),
});

export type PricingDraftInput = z.input<typeof pricingDraftSchema>;

export async function saveClientBillingHolidaysAction(input: {
  clientId: string;
  expectedUpdatedAt: string;
  year: number;
  rows: BillingHoliday[];
}): Promise<ActionResponse<{ updatedAt: string }>> {
  let actor;
  try { actor = await assertAdmin(); } catch { return { ok: false, error: "forbidden" }; }
  if (!z.string().uuid().safeParse(input.clientId).success || !z.string().datetime().safeParse(input.expectedUpdatedAt).success) {
    return { ok: false, error: "Ungültige Kundendaten." };
  }
  let rows: BillingHoliday[];
  try { rows = validateBillingHolidays(input.year, input.rows); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Ungültige Feiertage." }; }
  try {
    const updatedAt = await prisma.$transaction(async (tx) => {
      const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { billingHolidayCalendar: true } });
      const calendar = parseBillingHolidayCalendar(client.billingHolidayCalendar);
      calendar.years[String(input.year)] = rows;
      const changed = await tx.client.updateMany({
        where: { id: input.clientId, updatedAt: new Date(input.expectedUpdatedAt) },
        data: { billingHolidayCalendar: calendar as unknown as Prisma.InputJsonValue },
      });
      if (changed.count !== 1) throw new Error("Die Kundendaten wurden zwischenzeitlich geändert. Bitte die Seite neu laden.");
      await tx.auditLog.create({ data: {
        userId: actor.id,
        action: "client.billing_holidays.updated",
        entity: "Client",
        entityId: input.clientId,
        metadata: { year: input.year, rows: rows.length, activeRows: rows.filter((row) => row.active).length },
      } });
      const saved = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { updatedAt: true } });
      return saved.updatedAt.toISOString();
    });
    revalidatePath(`/admin/clients/${input.clientId}/rates`);
    return { ok: true, data: { updatedAt } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Feiertage konnten nicht gespeichert werden." };
  }
}

/** Saves the single editable pricing form and an append-only dated record for each changed client rate. */
export async function saveClientPricingDraftAction(
  raw: PricingDraftInput,
): Promise<ActionResponse<{ updatedAt: string }>> {
  let actor;
  try {
    actor = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const parsed = pricingDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Ungültige Vergütungswerte. Bitte Zahlen und Zeiten prüfen." };
  }
  const input = parsed.data;
  if ((input.nightStart === null) !== (input.nightEnd === null)) {
    return { ok: false, error: "Nachtbeginn und Nachtende müssen beide ausgefüllt oder beide leer sein." };
  }
  try {
    const updatedAt = await prisma.$transaction(async (tx) => {
      const previous = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { hourlyRates: true } });
      const existingRates = previous.hourlyRates && typeof previous.hourlyRates === "object" && !Array.isArray(previous.hourlyRates)
        ? previous.hourlyRates as Record<string, unknown> : {};
      const known = await tx.qualificationCatalog.findMany({
        where: { code: { in: Object.keys(input.hourlyRates) } },
        select: { code: true, active: true },
      });
      const allowed = new Set(known.filter((item) => item.active || Object.hasOwn(existingRates, item.code)).map((item) => item.code));
      if (Object.keys(input.hourlyRates).some((code) => !allowed.has(code))) {
        throw new Error("Unbekannte oder archivierte Qualifikation. Bitte die Seite neu laden.");
      }
      const rates: Record<string, number> = Object.fromEntries(Object.entries(existingRates)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])));
      for (const [code, value] of Object.entries(input.hourlyRates)) {
        if (value === null) delete rates[code];
        else rates[code] = value;
      }
      const effectiveFrom = todayInBerlin();
      const priceChanges = Object.entries(input.hourlyRates).flatMap(([code, value]) => {
        const old = typeof existingRates[code] === "number" && Number.isFinite(existingRates[code])
          ? Math.round((existingRates[code] as number) * 100) : null;
        const next = value === null ? null : Math.round(value * 100);
        if (old === next) return [];
        const terms = {
          clientId: input.clientId, qualificationCode: code, hourlyRateInCents: next,
          effectiveFrom, verifiedByUserId: actor.id, sourceReference: CLIENT_RATE_CHANGE_SOURCE,
        };
        return [{ ...terms, frozenHash: hashClientPricingRateChange(terms) }];
      });
      const changed = await tx.client.updateMany({
        where: { id: input.clientId, updatedAt: new Date(input.expectedUpdatedAt) },
        data: {
          surchargeSat: input.surchargeSatPct === null ? null : input.surchargeSatPct / 100,
          surchargeSun: input.surchargeSunPct === null ? null : input.surchargeSunPct / 100,
          surchargeHoliday: input.surchargeHolidayPct === null ? null : input.surchargeHolidayPct / 100,
          surchargeNight: input.surchargeNightPct === null ? null : input.surchargeNightPct / 100,
          nightStart: input.nightStart,
          nightEnd: input.nightEnd,
          hourlyRates: Object.keys(rates).length ? rates : Prisma.JsonNull,
        },
      });
      if (changed.count !== 1) {
        throw new Error("Die Vergütung wurde zwischenzeitlich geändert. Bitte die Seite neu laden.");
      }
      if (priceChanges.length) {
        await tx.clientPricingRateChange.createMany({
          data: priceChanges.map((change) => ({
            ...change, effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "client.pricing_draft.updated",
          entity: "Client",
          entityId: input.clientId,
          metadata: { source: "vergütung_v2_page", effectiveFrom, priceChanges: priceChanges.map((change) => ({ qualification: change.qualificationCode, cents: change.hourlyRateInCents })), frozenVersionsChanged: false },
        },
      });
      const client = await tx.client.findUniqueOrThrow({
        where: { id: input.clientId }, select: { updatedAt: true },
      });
      return client.updatedAt.toISOString();
    });
    revalidatePath(`/admin/clients/${input.clientId}/rates`);
    revalidatePath(`/admin/clients/${input.clientId}/edit`);
    return { ok: true, data: { updatedAt } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Vergütung konnte nicht gespeichert werden." };
  }
}

export type ActionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown };

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || !roleSatisfies(user.role, ["admin"])) {
    throw new Error("forbidden");
  }
  return user;
}

export type ApprovalPreviewInput = {
  clientId: string;
  clientContractId?: string | null;
  sourceType: "contract" | "framework_agreement" | "contract_amendment" | "setting";
  sourceReference: string;
  effectiveFrom: string;
  effectiveTo: string;
  // Surcharge policy terms
  approveSurcharges: boolean;
  federalState?: GermanFederalState | string;
  municipality?: string | null;
  districtLocality?: string | null;
  nightStart?: string;
  nightEnd?: string;
  combinationRule?: SurchargeCombinationRule | string;
  surchargeSat?: number;
  surchargeSun?: number;
  surchargeHoliday?: number;
  surchargeNight?: number;
  zeroRateRationale?: Record<string, string>;
  // Hourly rates terms
  approveRates: boolean;
  selectedRates?: Array<{
    qualification: string;
    hourlyRateEur: number;
  }>;
};

export type ApprovalPreviewResult = {
  surchargePreview?: FacilitySurchargePolicyPreviewSummary | null;
  ratePreviews: RateVersionPreviewSummary[];
};

export type ApprovalCommitInput = ApprovalPreviewInput & {
  expectedSurchargeHash?: string | null;
  expectedRateHashes: Record<string, string>; // qualification -> hash
};

/**
 * Validates and previews the conversion of profile values into immutable V2 records.
 * Does NOT write anything to the database.
 */
export async function previewClientApprovalAction(
  input: ApprovalPreviewInput
): Promise<ActionResponse<ApprovalPreviewResult>> {
  let actor;
  try {
    actor = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  if (!input.clientId || typeof input.clientId !== "string") {
    return { ok: false, error: "missingClientId" };
  }

  if (!input.approveSurcharges && !input.approveRates) {
    return { ok: false, error: "noApprovalSelection" };
  }

  if (input.sourceType === "setting") {
    if (input.clientContractId) {
      return { ok: false, error: "Profileinstellungen müssen ohne Einzelvertrag bestätigt werden." };
    }
    const profile = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: {
        hourlyRates: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
      },
    });
    if (!profile) return { ok: false, error: "Kundenprofil nicht gefunden." };
    const profileRates = profile.hourlyRates && typeof profile.hourlyRates === "object" && !Array.isArray(profile.hourlyRates)
      ? profile.hourlyRates as Record<string, unknown>
      : {};
    const sameRate = (actual: number | null, submitted: number | undefined) =>
      actual !== null && submitted !== undefined && Number.isFinite(submitted) &&
      Math.abs(actual - submitted) < 0.000001;
    if (input.approveSurcharges && (
      !sameRate(profile.surchargeSat, input.surchargeSat) ||
      !sameRate(profile.surchargeSun, input.surchargeSun) ||
      !sameRate(profile.surchargeHoliday, input.surchargeHoliday) ||
      !sameRate(profile.surchargeNight, input.surchargeNight) ||
      profile.nightStart !== input.nightStart || profile.nightEnd !== input.nightEnd
    )) {
      return { ok: false, error: "Zuschläge fehlen oder wurden geändert. Bitte die Werte oben auf dieser Seite speichern und die Seite neu laden." };
    }
    if (input.approveRates && (!input.selectedRates?.length || input.selectedRates.some((rate) => {
      const stored = profileRates[rate.qualification];
      return typeof stored !== "number" || !Number.isFinite(stored) ||
        Math.round(stored * 100) !== Math.round(rate.hourlyRateEur * 100);
    }))) {
      return { ok: false, error: "Stundensätze fehlen oder wurden geändert. Bitte die Werte oben auf dieser Seite speichern und die Seite neu laden." };
    }
  }

  // Administrative profile approval is identified by the authenticated actor
  // and a truthful source label; the browser cannot supply a fake document.
  const sourceReference = input.sourceType === "setting"
    ? "Vergütungsseite: administrativ bestätigte Vergütung und Zuschläge"
    : input.sourceReference;

  // 1. Preview Surcharge Policy if selected
  let surchargePreview: FacilitySurchargePolicyPreviewSummary | null = null;
  if (input.approveSurcharges) {
    if (!input.federalState || !input.combinationRule || !input.nightStart || !input.nightEnd) {
      return { ok: false, error: "missingSurchargeFields" };
    }

    if (
      input.surchargeSat === undefined ||
      input.surchargeSun === undefined ||
      input.surchargeHoliday === undefined ||
      input.surchargeNight === undefined
    ) {
      return { ok: false, error: "missingSurchargeRates" };
    }

    const surchargeInput = {
      clientId: input.clientId,
      clientContractId: input.clientContractId ?? null,
      policyVersion: 1, // Will be computed by service
      federalState: input.federalState,
      municipality: input.municipality?.trim() || null,
      districtLocality: input.districtLocality?.trim() || null,
      surchargeSat: input.surchargeSat,
      surchargeSun: input.surchargeSun,
      surchargeHoliday: input.surchargeHoliday,
      surchargeNight: input.surchargeNight,
      nightStart: input.nightStart,
      nightEnd: input.nightEnd,
      combinationRule: input.combinationRule,
      // The policy enum records contractual provenance; the specific amendment
      // remains identifiable in sourceReference. Rate versions retain their own
      // more detailed source type.
      sourceType: input.sourceType === "setting"
        ? "setting"
        : input.sourceType === "framework_agreement" || input.sourceType === "contract_amendment"
        ? "contract"
        : input.sourceType,
      sourceReference,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      verifiedByUserId: actor.id,
      verifiedAt: new Date().toISOString(),
      isFrozen: true,
      zeroRateRationale: input.zeroRateRationale,
    };

    const res = await previewFacilitySurchargePolicy({
      prisma,
      input: surchargeInput,
      actorUserId: actor.id,
    });

    if (!res.success) {
      return { ok: false, error: res.message, details: res.details };
    }
    surchargePreview = res.data;
  }

  // 2. Preview Hourly Rates if selected
  const ratePreviews: RateVersionPreviewSummary[] = [];
  if (input.approveRates) {
    if (!input.selectedRates || input.selectedRates.length === 0) {
      return { ok: false, error: "noRatesSelected" };
    }

    for (const r of input.selectedRates) {
      if (!r.hourlyRateEur || r.hourlyRateEur <= 0) {
        return {
          ok: false,
          error: `Stundensatz für "${r.qualification}" muss größer als 0 sein. Standardwerte oder Null sind unzulässig.`,
        };
      }

      const cents = Math.round(r.hourlyRateEur * 100);
      const rateInput = {
        clientId: input.clientId,
        clientContractId: input.clientContractId ?? null,
        qualification: r.qualification,
        hourlyRateInCents: cents,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        sourceType: input.sourceType,
        sourceReference,
        verifyingUserId: actor.id,
      };

      const res = await previewClientHourlyRate({
        prisma,
        input: rateInput,
        actorUserId: actor.id,
      });

      if (!res.success) {
        const validationErrors = Array.isArray(res.details?.errors)
          ? res.details.errors.filter((error): error is string => typeof error === "string")
          : [];
        return {
          ok: false,
          error: validationErrors.length > 0 ? `${res.message} ${validationErrors.join(" ")}` : res.message,
          details: res.details,
        };
      }
      ratePreviews.push(res.data);
    }
  }

  return {
    ok: true,
    data: {
      surchargePreview,
      ratePreviews,
    },
  };
}

/**
 * Commits and permanently freezes the reviewed and approved rates & surcharges.
 * Atomic transaction + immutable audit log entry.
 */
export async function commitClientApprovalAction(
  input: ApprovalCommitInput
): Promise<ActionResponse<{ surchargePolicyId?: string; rateVersionIds: string[] }>> {
  let actor;
  try {
    actor = await assertAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }

  // Re-run preview check to enforce hash binding
  const preview = await previewClientApprovalAction(input);
  if (!preview.ok) {
    return preview;
  }

  const p = preview.data;

  // Strict Hash Binding check:
  if (input.approveSurcharges) {
    if (!p.surchargePreview) {
      return { ok: false, error: "surchargePreviewMissing" };
    }
    if (
      !input.expectedSurchargeHash ||
      input.expectedSurchargeHash !== p.surchargePreview.integrity.canonicalHash
    ) {
      return {
        ok: false,
        error: "Sicherheitsprüfung fehlgeschlagen: Der Hash der Zuschlagsrichtlinie stimmt nicht mit der bestätigten Vorschau überein.",
      };
    }
  }

  if (input.approveRates) {
    for (const rp of p.ratePreviews) {
      const qual = rp.rateTerms.qualification;
      const expected = input.expectedRateHashes[qual];
      if (!expected || expected !== rp.integrity.canonicalHash) {
        return {
          ok: false,
          error: `Sicherheitsprüfung fehlgeschlagen: Der Hash für "${qual}" stimmt nicht mit der bestätigten Vorschau überein.`,
        };
      }
    }
  }

  // Execute in Prisma Transaction
  try {
    let createdPolicyId: string | undefined;
    const createdRateIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      // 1. Commit Surcharge Policy
      if (input.approveSurcharges && p.surchargePreview) {
        const sp = p.surchargePreview;
        const createdPolicy = await tx.facilitySurchargePolicy.create({
          data: {
            clientId: sp.scope.clientId,
            clientContractId: sp.scope.clientContractId,
            policyVersion: sp.terms.policyVersion,
            federalState: sp.terms.federalState,
            municipality: sp.terms.municipality,
            districtLocality: sp.terms.districtLocality,
            surchargeSat: sp.terms.surchargeSat,
            surchargeSun: sp.terms.surchargeSun,
            surchargeHoliday: sp.terms.surchargeHoliday,
            surchargeNight: sp.terms.surchargeNight,
            nightStart: sp.terms.nightStart,
            nightEnd: sp.terms.nightEnd,
            combinationRule: sp.terms.combinationRule,
            sourceType: sp.provenance.sourceType,
            sourceReference: sp.provenance.sourceReference,
            verifiedByUserId: actor.id,
            verifiedAt: new Date(sp.provenance.verifiedAtIso),
            effectiveFrom: new Date(sp.terms.effectiveFrom),
            effectiveTo: sp.terms.effectiveTo ? new Date(sp.terms.effectiveTo) : null,
            isFrozen: true,
            frozenAt: new Date(),
            frozenHash: sp.integrity.canonicalHash,
          },
        });
        createdPolicyId = createdPolicy.id;
      }

      // 2. Commit Rate Versions
      if (input.approveRates) {
        for (const rp of p.ratePreviews) {
          const createdRate = await tx.clientHourlyRateVersion.create({
            data: {
              clientId: rp.scope.clientId,
              clientContractId: rp.scope.clientContractId,
              rateVersion: rp.rateTerms.rateVersion,
              qualification: rp.rateTerms.qualification,
              hourlyRateInCents: rp.rateTerms.hourlyRateInCents,
              effectiveFrom: new Date(rp.rateTerms.effectiveFrom),
              effectiveTo: new Date(rp.rateTerms.effectiveTo),
              sourceType: rp.provenance.sourceType,
              sourceReference: rp.provenance.sourceReference,
              sourceDocumentUrl: rp.provenance.sourceDocumentUrl,
              isFrozen: true,
              frozenAt: new Date(),
              frozenHash: rp.integrity.canonicalHash,
              verifiedByUserId: actor.id,
              verifiedAt: new Date(rp.provenance.verifiedAtIso),
            },
          });
          createdRateIds.push(createdRate.id);
        }
      }

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "client.rates_and_surcharges.approved",
          entity: "Client",
          entityId: input.clientId,
          metadata: {
            policyVersion: p.surchargePreview?.terms.policyVersion ?? null,
            surchargeHash: p.surchargePreview?.integrity.canonicalHash ?? null,
            ratesApprovedCount: createdRateIds.length,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo,
            sourceType: input.sourceType,
            sourceReference: p.surchargePreview?.provenance.sourceReference ?? p.ratePreviews[0]?.provenance.sourceReference ?? null,
            contractReference: input.sourceType === "setting" ? null : input.sourceReference,
            clientContractId: input.clientContractId ?? null,
          },
        },
      });
    });

    revalidatePath(`/admin/clients/${input.clientId}/rates`);
    revalidatePath(`/admin/clients/${input.clientId}/edit`);
    revalidatePath("/admin/clients");

    return {
      ok: true,
      data: {
        surchargePolicyId: createdPolicyId,
        rateVersionIds: createdRateIds,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Fehler beim Einfrieren der Vergütung.";
    return { ok: false, error: errorMsg };
  }
}
