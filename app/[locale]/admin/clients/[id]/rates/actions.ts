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
  sourceType: "contract" | "framework_agreement" | "contract_amendment";
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
      sourceType: input.sourceType === "framework_agreement" ? "contract" : input.sourceType,
      sourceReference: input.sourceReference,
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
        sourceReference: input.sourceReference,
        verifyingUserId: actor.id,
      };

      const res = await previewClientHourlyRate({
        prisma,
        input: rateInput,
        actorUserId: actor.id,
      });

      if (!res.success) {
        return { ok: false, error: res.message, details: res.details };
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
            contractReference: input.sourceReference,
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
    const errorMsg = err instanceof Error ? err.message : "Fehler beim Einfrieren der Tarife.";
    return { ok: false, error: errorMsg };
  }
}
