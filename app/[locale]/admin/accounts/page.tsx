import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";
import type { Locale } from "@/i18n/routing";

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

  const users = await prisma.user
    .findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, fullName: true, role: true, active: true },
    })
    .catch(() => []);

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

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fullName")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("role")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-end">{c("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.fullName ?? c("none")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{er(u.role)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.active ? "default" : "outline"}>
                      {u.active ? t("statusActive") : t("statusInactive")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {u.role === "super_admin" ? (
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
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
