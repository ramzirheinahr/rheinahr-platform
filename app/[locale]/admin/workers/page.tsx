import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Plus, Pencil } from "lucide-react";

type WorkerRow = Awaited<ReturnType<typeof getWorkers>>[number];

export const dynamic = "force-dynamic";

async function getWorkers() {
  try {
    return await prisma.worker.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } } },
    });
  } catch {
    return [];
  }
}

export default async function WorkersPage() {
  const t = await getTranslations("workers");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const ec = await getTranslations("enums.contractType");
  const workers = await getWorkers();

  const columns: Column<WorkerRow>[] = [
    { header: t("fullName"), primary: true, cell: (w) => w.fullName },
    { header: t("email"), cell: (w) => w.user.email },
    {
      header: t("qualification"),
      cell: (w) => <Badge variant="secondary">{eq(w.qualification)}</Badge>,
    },
    { header: t("contractType"), cell: (w) => ec(w.contractType) },
    { header: t("phone"), cell: (w) => w.phone || c("none") },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (w) => (
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/workers/${w.id}/edit`} />}
        >
          <Pencil className="size-4" />
          {c("edit")}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button
          render={<Link href="/admin/accounts/new?role=worker" />}
          className="gap-2"
        >
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={workers}
        getRowKey={(w) => w.id}
        empty={t("empty")}
      />
    </div>
  );
}
