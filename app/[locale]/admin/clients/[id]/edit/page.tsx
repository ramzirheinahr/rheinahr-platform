import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/admin/client-form";
import { DeleteClientButton } from "@/components/admin/delete-client-button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("clients");
  const c = await getTranslations("common");

  const client = await prisma.client
    .findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    })
    .catch(() => null);

  if (!client) notFound();

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
          email: client.user.email,
          facilityName: client.facilityName,
          facilityType: client.facilityType,
          address: client.address,
          contactPerson: client.contactPerson,
          billingInfo: client.billingInfo,
        }}
      />
    </div>
  );
}
