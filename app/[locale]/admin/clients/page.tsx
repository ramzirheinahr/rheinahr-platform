import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ClientsTable, type ClientTableRow } from "@/components/admin/clients-table";
import { Plus } from "lucide-react";
import { getFacilityTypeLabelMap } from "@/lib/facility-type-catalog";

export const dynamic = "force-dynamic";

async function getClients() {
  try {
    return await prisma.client.findMany({
      // Sort by internal number by default.
      orderBy: { internalNumber: "asc" },
      include: { 
        user: { select: { id: true, email: true, receiveEmails: true, _count: { select: { sessions: true } } } },
        subUsers: { select: { _count: { select: { sessions: true } } } },
      },
    });
  } catch {
    return [];
  }
}

export default async function ClientsPage() {
  const locale = await getLocale();
  const t = await getTranslations("clients");
  const c = await getTranslations("common");
  const ef = await getTranslations("enums.facilityType");
  const typeMap = await getFacilityTypeLabelMap(locale);
  const actor = await getCurrentUser();
  const clients = await getClients();

  const rows: ClientTableRow[] = clients.map((cl) => {
    let facilityTypeLabel = typeMap.get(cl.facilityType);
    if (!facilityTypeLabel) {
      try {
        facilityTypeLabel = ef(cl.facilityType);
      } catch {
        facilityTypeLabel = cl.facilityType;
      }
    }

    return {
      id: cl.id,
      facilityName: cl.facilityName,
      internalNumber: cl.internalNumber ?? "",
      facilityTypeLabel: facilityTypeLabel || cl.facilityType,
      contactPerson: cl.contactPerson || c("none"),
      email: cl.user.email,
      userId: cl.user.id,
      receiveEmails: cl.user.receiveEmails,
      shortCode: cl.shortCode ?? "",
      activeSessionsCount: cl.user._count.sessions + cl.subUsers.reduce((sum, u) => sum + u._count.sessions, 0),
    };
  });

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
