import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ClientCreateForm } from "@/components/admin/client-create-form";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { facilityTypes } from "@/lib/validations";

export const dynamic = "force-dynamic";

export default async function NewClientPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale as Locale);

  const t = await getTranslations("clients");
  const c = await getTranslations("common");

  const allTypes = await prisma.client.findMany({ select: { facilityType: true }, distinct: ["facilityType"] });
  const customFacilityTypes = allTypes
    .map((c) => c.facilityType)
    .filter((t) => !facilityTypes.includes(t as any));

  return (
    <div className="space-y-6">
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
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
      </div>
      <ClientCreateForm customFacilityTypes={customFacilityTypes} />
    </div>
  );
}
