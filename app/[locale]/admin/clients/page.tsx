import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ClientsTable, type ClientTableRow } from "@/components/admin/clients-table";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

async function getClients() {
  try {
    return await prisma.client.findMany({
      // Alphabetical by facility name so the list reads like a directory.
      orderBy: { facilityName: "asc" },
      include: { user: { select: { email: true } } },
    });
  } catch {
    return [];
  }
}

export default async function ClientsPage() {
  const t = await getTranslations("clients");
  const c = await getTranslations("common");
  const ef = await getTranslations("enums.facilityType");
  const actor = await getCurrentUser();
  const clients = await getClients();

  const rows: ClientTableRow[] = clients.map((cl) => ({
    id: cl.id,
    facilityName: cl.facilityName,
    facilityTypeLabel: ef(cl.facilityType),
    contactPerson: cl.contactPerson || c("none"),
    email: cl.user.email,
    shortCode: cl.shortCode ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {/* Creating a facility provisions its login account — super_admin only. */}
        {actor?.role === "super_admin" && (
          <Button render={<Link href="/admin/clients/new" />} className="gap-2">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </div>

      <ClientsTable rows={rows} />
    </div>
  );
}
