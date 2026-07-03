import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Plus, Pencil, Clock } from "lucide-react";

type ClientRow = Awaited<ReturnType<typeof getClients>>[number];

export const dynamic = "force-dynamic";

async function getClients() {
  try {
    return await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
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

  const columns: Column<ClientRow>[] = [
    { header: t("facilityName"), primary: true, cell: (cl) => cl.facilityName },
    {
      header: t("facilityType"),
      cell: (cl) => <Badge variant="secondary">{ef(cl.facilityType)}</Badge>,
    },
    { header: t("contactPerson"), cell: (cl) => cl.contactPerson || c("none") },
    { header: t("email"), cell: (cl) => cl.user.email },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (cl) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/clients/${cl.id}/schedule`} />}
          >
            <Clock className="size-4" />
            {t("hoursAction")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/clients/${cl.id}/edit`} />}
          >
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        </div>
      ),
    },
  ];

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

      <ResponsiveTable
        columns={columns}
        rows={clients}
        getRowKey={(cl) => cl.id}
        empty={t("empty")}
      />
    </div>
  );
}
