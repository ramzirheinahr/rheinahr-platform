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
import { ArrowLeft } from "lucide-react";
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
        user: { select: { id: true, email: true, active: true, receiveEmails: true, loginToken: true, fullName: true, jobTitle: true } },
        subUsers: { select: { id: true, email: true, fullName: true, jobTitle: true, active: true } }
      },
    })
    .catch(() => null);

  if (!client) notFound();

  const allTypes = await prisma.client.findMany({ select: { facilityType: true }, distinct: ["facilityType"] });
  const customFacilityTypes = allTypes
    .map((c) => c.facilityType)
    .filter((t) => !facilityTypes.includes(t as any));

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
        <DeleteClientButton id={client.id} />
      </div>

      <ClientForm
        client={{
          id: client.id,
          facilityName: client.facilityName,
          shortCode: client.shortCode,
          facilityType: client.facilityType,
          address: client.address,
          contactPerson: client.contactPerson,
          billingInfo: client.billingInfo,
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
        url={client.frameworkAgreementUrl}
        signedAt={client.frameworkAgreementSignedAt}
      />

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
                isMainUser: true,
              },
              ...client.subUsers.map(u => ({
                id: u.id,
                email: u.email,
                fullName: u.fullName,
                jobTitle: u.jobTitle,
                active: u.active,
                isMainUser: false,
              }))
            ]}
            isMainUser={true}
            clientId={client.id}
          />
        </div>
      )}
    </div>
  );
}
