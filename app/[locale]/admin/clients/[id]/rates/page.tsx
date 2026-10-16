import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, roleSatisfies } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ClientRatesApprovalContent } from "@/components/admin/client-rates-approval-content";
import { getQualificationCatalog } from "@/lib/qualification-catalog";

export const dynamic = "force-dynamic";

export default async function ClientRatesApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
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
  const catalog = await getQualificationCatalog({ includeArchived: true });

  // Parse raw profile hourly rates
  const rawProfileRates =
    client.hourlyRates && typeof client.hourlyRates === "object"
      ? (client.hourlyRates as Record<string, unknown>)
      : {};

  const profileHourlyRates: Record<string, number | null> = {};
  const availableQualifications = catalog.filter((item) =>
    item.active || Object.hasOwn(rawProfileRates, item.code) ||
    client.hourlyRateVersions.some((rate) => rate.qualification === item.code));
  for (const { code: q } of availableQualifications) {
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

  const requestedFrom = typeof from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(from) &&
    !Number.isNaN(Date.parse(`${from}T00:00:00.000Z`)) &&
    new Date(`${from}T00:00:00.000Z`).toISOString().slice(0, 10) === from
    ? from
    : null;
  const nextVersionStart = requestedFrom
    ? [
        ...client.surchargePolicies.map((policy) => policy.effectiveFrom.toISOString().slice(0, 10)),
        ...client.hourlyRateVersions
          .filter((rate) => rate.clientContractId === null)
          .map((rate) => rate.effectiveFrom.toISOString().slice(0, 10)),
      ].filter((date) => date > requestedFrom).sort()[0]
    : null;
  const yearEnd = requestedFrom ? `${requestedFrom.slice(0, 4)}-12-31` : null;
  const dayBeforeNextVersion = nextVersionStart
    ? new Date(Date.parse(`${nextVersionStart}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
    : null;
  const suggestedEffectiveTo = yearEnd && dayBeforeNextVersion && dayBeforeNextVersion < yearEnd
    ? dayBeforeNextVersion
    : yearEnd;

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
        key={client.updatedAt.toISOString()}
        clientId={client.id}
        pricingUpdatedAt={client.updatedAt.toISOString()}
        initialEffectiveFrom={requestedFrom}
        initialEffectiveTo={suggestedEffectiveTo}
        facilityName={client.facilityName}
        hasFrameworkAgreement={Boolean(client.frameworkAgreementSignedAt && client.frameworkAgreementUrl)}
        frameworkAgreementUrl={client.frameworkAgreementUrl}
        contracts={contracts}
        profileHourlyRates={profileHourlyRates}
        qualifications={availableQualifications}
        profileSurcharges={profileSurcharges}
        billingHolidayCalendar={client.billingHolidayCalendar}
        activePolicies={activePolicies}
        activeRateVersions={activeRateVersions}
      />
    </div>
  );
}
