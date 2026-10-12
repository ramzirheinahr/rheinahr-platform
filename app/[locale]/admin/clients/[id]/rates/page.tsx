import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ClientRatesApprovalContent } from "@/components/admin/client-rates-approval-content";
import { qualifications } from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function ClientRatesApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("ratesApproval");
  const actor = await getCurrentUser();

  if (!actor || !roleSatisfies(actor.role, ["admin"])) {
    redirect("/admin");
  }

  const client = await prisma.client
    .findUnique({
      where: { id },
      include: {
        contracts: {
          where: { status: "signed" },
          select: {
            id: true,
            period: true,
            documentUrl: true,
            signedAt: true,
          },
        },
        hourlyRateVersions: {
          orderBy: [{ qualification: "asc" }, { rateVersion: "desc" }],
          include: {
            verifiedByUser: { select: { fullName: true, email: true } },
          },
        },
        surchargePolicies: {
          orderBy: { policyVersion: "desc" },
          include: {
            verifiedByUser: { select: { fullName: true, email: true } },
          },
        },
      },
    })
    .catch(() => null);

  if (!client) {
    notFound();
  }

  // Parse raw profile hourly rates
  const rawProfileRates =
    client.hourlyRates && typeof client.hourlyRates === "object"
      ? (client.hourlyRates as Record<string, unknown>)
      : {};

  const profileHourlyRates: Record<string, number | null> = {};
  for (const q of qualifications) {
    const val = rawProfileRates[q];
    profileHourlyRates[q] = typeof val === "number" ? val : null;
  }

  const profileSurcharges = {
    surchargeSat: client.surchargeSat,
    surchargeSun: client.surchargeSun,
    surchargeHoliday: client.surchargeHoliday,
    surchargeNight: client.surchargeNight,
    nightStart: client.nightStart,
    nightEnd: client.nightEnd,
  };

  const activePolicies = client.surchargePolicies.map((p) => ({
    id: p.id,
    policyVersion: p.policyVersion,
    federalState: p.federalState,
    municipality: p.municipality,
    districtLocality: p.districtLocality,
    surchargeSat: p.surchargeSat,
    surchargeSun: p.surchargeSun,
    surchargeHoliday: p.surchargeHoliday,
    surchargeNight: p.surchargeNight,
    nightStart: p.nightStart,
    nightEnd: p.nightEnd,
    combinationRule: p.combinationRule,
    sourceType: p.sourceType,
    sourceReference: p.sourceReference,
    effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString().slice(0, 10) : null,
    isFrozen: p.isFrozen,
    frozenHash: p.frozenHash,
    verifiedBy: p.verifiedByUser?.fullName || p.verifiedByUser?.email || null,
    verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
  }));

  const activeRateVersions = client.hourlyRateVersions.map((r) => ({
    id: r.id,
    rateVersion: r.rateVersion,
    qualification: r.qualification,
    hourlyRateInCents: r.hourlyRateInCents,
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
    sourceType: r.sourceType,
    sourceReference: r.sourceReference,
    isFrozen: r.isFrozen,
    frozenHash: r.frozenHash,
    verifiedBy: r.verifiedByUser?.fullName || r.verifiedByUser?.email || null,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
  }));

  const contracts = client.contracts.map((ct) => ({
    id: ct.id,
    period: ct.period,
    documentUrl: ct.documentUrl,
    signedAt: ct.signedAt ? ct.signedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/clients/${client.id}/edit`} />}
        >
          <ArrowLeft className="size-4" />
          {t("backToEdit")}
        </Button>
      </div>

      <ClientRatesApprovalContent
        clientId={client.id}
        facilityName={client.facilityName}
        hasFrameworkAgreement={Boolean(client.frameworkAgreementSignedAt && client.frameworkAgreementUrl)}
        frameworkAgreementUrl={client.frameworkAgreementUrl}
        contracts={contracts}
        profileHourlyRates={profileHourlyRates}
        profileSurcharges={profileSurcharges}
        activePolicies={activePolicies}
        activeRateVersions={activeRateVersions}
      />
    </div>
  );
}
