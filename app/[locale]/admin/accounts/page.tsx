import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Plus, Pencil } from "lucide-react";
import type { Locale } from "@/i18n/routing";

type AccountRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: "super_admin" | "admin" | "client" | "worker";
  active: boolean;
};

export const dynamic = "force-dynamic";

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale as Locale);

  const t = await getTranslations("accounts");
  const c = await getTranslations("common");
  const er = await getTranslations("enums.role");

  const users: AccountRow[] = await prisma.user
    .findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, fullName: true, role: true, active: true },
    })
    .catch(() => []);

  const columns: Column<AccountRow>[] = [
    { header: t("fullName"), primary: true, cell: (u) => u.fullName ?? c("none") },
    { header: t("email"), cell: (u) => u.email },
    { header: t("role"), cell: (u) => <Badge variant="secondary">{er(u.role)}</Badge> },
    {
      header: t("status"),
      cell: (u) => (
        <Badge variant={u.active ? "default" : "outline"}>
          {u.active ? t("statusActive") : t("statusInactive")}
        </Badge>
      ),
    },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (u) =>
        u.role === "super_admin" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/accounts/${u.id}/edit`} />}
          >
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button render={<Link href="/admin/accounts/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={users}
        getRowKey={(u) => u.id}
        empty={t("empty")}
      />
    </div>
  );
}
