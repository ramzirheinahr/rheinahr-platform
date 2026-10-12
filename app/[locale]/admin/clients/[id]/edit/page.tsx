import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/admin/client-form";
import { AccountSection } from "@/components/admin/account-section";
import { DeleteClientButton } from "@/components/admin/delete-client-button";
import { RahmenvertragSection } from "@/components/admin/rahmenvertrag-section";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { qualifications, facilityTypes } from "@/lib/validations";

export const dynamic = "force-dynamic";

// Only the qualifications this facility actually overrides — so blank inputs
// keep showing the platform default as a placeholder (not a prefilled value).
function resolveRateOverrides(
  raw: unknown,
): Partial<Record<(typeof qualifications)[number], number>> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<(typeof qualifications)[number], number>> = {};
  for (const q of qualifications) {
    if (typeof src[q] === "number") out[q] = src[q] as number;
  }
  return out;
}

import { SubUsersSection } from "@/app/[locale]/client/settings/sub-users-section";
import { ActiveSessionsSection } from "@/components/admin/active-sessions-section";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("clients");
  const c = await getTranslations("common");
  const actor = await getCurrentUser();

  const client = await prisma.client
    .findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, active: true, receiveEmails: true, loginToken: true, fullName: true, jobTitle: true, sessions: { select: { id: true, device: true, ipAddress: true, lastActive: true, createdAt: true } } } },
        subUsers: { select: { id: true, email: true, fullName: true, jobTitle: true, active: true, receiveEmails: true, sessions: { select: { id: true, device: true, ipAddress: true, lastActive: true, createdAt: true } } } },
        _count: { select: { hourlyRateVersions: true, surchargePolicies: true } },
      },
    })
    .catch(() => null);

  if (!client) notFound();

  const allTypes = await prisma.client.findMany({ select: { facilityType: true }, distinct: ["facilityType"] });
  const customFacilityTypes = allTypes
    .map((c) => c.facilityType)
    .filter((t) => !facilityTypes.includes(t as (typeof facilityTypes)[number]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href="/admin/clients" />}
          >
            <ArrowLeft className="size-4" />
            {c("back")}
          </Button>
          <h1 className="text-2xl font-semibold">{t("editTitle")}</h1>
        </div>
        <div className="pr-10">
          <DeleteClientButton id={client.id} />
        </div>
      </div>

      <ClientForm
        client={{
          id: client.id,
          facilityName: client.facilityName,
          internalNumber: client.internalNumber,
          shortCode: client.shortCode,
          facilityType: client.facilityType,
          address: client.address,
          contactPerson: client.contactPerson,
          billingEmail: client.billingEmail,
          billingInfo: client.billingInfo,
          paymentTermsDays: client.paymentTermsDays,
          surchargeSat: client.surchargeSat,
          surchargeSun: client.surchargeSun,
          surchargeHoliday: client.surchargeHoliday,
          surchargeNight: client.surchargeNight,
          nightStart: client.nightStart,
          nightEnd: client.nightEnd,
          hourlyRates: resolveRateOverrides(client.hourlyRates),
          user: {
            receiveEmails: client.user.receiveEmails,
          },
        }}
        customFacilityTypes={customFacilityTypes}
      />

      {/* Rahmenvertrag Management */}
      <RahmenvertragSection 
        clientId={client.id}
        url={client.frameworkAgreementUrl ? `/api/clients/${client.id}/signed-rahmenvertrag` : null}
        signedAt={client.frameworkAgreementSignedAt}
      />

      {/* V2 Pricing & Surcharge Policies Verification */}
      {(() => {
        const hasV2 =
          (client._count?.hourlyRateVersions ?? 0) > 0 &&
          (client._count?.surchargePolicies ?? 0) > 0;
        return (
          <div className="rounded-xl border p-4 bg-card space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-primary" />
                  <h2 className="text-base font-semibold">{t("v2RatesStatus")}</h2>
                  <Badge
                    variant={hasV2 ? "default" : "outline"}
                    className={
                      hasV2
                        ? "bg-emerald-600 text-white"
                        : "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30"
                    }
                  >
                    {hasV2 ? t("v2StatusVerified") : t("v2StatusPending")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t("v2CardDesc")}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0"
                render={<Link href={`/admin/clients/${client.id}/rates`} />}
              >
                <ShieldCheck className="size-4" />
                {t("manageRates")}
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Login account management (password, access link, active) — super_admin only. */}
      {actor?.role === "super_admin" && (
        <AccountSection
          userId={client.user.id}
          email={client.user.email}
          active={client.user.active}
          hasLink={!!client.user.loginToken}
        />
      )}

      {/* Sub-users management */}
      {actor?.role === "super_admin" && (
        <div className="pt-4 border-t">
          <SubUsersSection 
            users={[
              {
                id: client.user.id,
                email: client.user.email,
                fullName: client.user.fullName,
                jobTitle: client.user.jobTitle,
                active: client.user.active,
                receiveEmails: client.user.receiveEmails,
                isMainUser: true,
              },
              ...client.subUsers.map(u => ({
                id: u.id,
                email: u.email,
                fullName: u.fullName,
                jobTitle: u.jobTitle,
                active: u.active,
                receiveEmails: u.receiveEmails,
                isMainUser: false,
              }))
            ]}
            isMainUser={true}
            clientId={client.id}
          />
        </div>
      )}

      {/* Active Sessions Management */}
      {actor?.role === "super_admin" && (
        <div className="pt-4 border-t">
          <ActiveSessionsSection
            users={[
              {
                id: client.user.id,
                email: client.user.email,
                fullName: client.user.fullName,
                sessions: client.user.sessions,
              },
              ...client.subUsers.map((u) => ({
                id: u.id,
                email: u.email,
                fullName: u.fullName,
                sessions: u.sessions,
              })),
            ]}
          />
        </div>
      )}
    </div>
  );
}
