"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";

export type UserRow = {
  id: string;
  email: string;
  fullName: string | null;
  active: boolean;
  permissions: string[];
};

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const t = useTranslations("users");
  const c = useTranslations("common");

  if (!rows.length) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-muted/50 text-muted-foreground border-b">
          <tr>
            <th className="px-4 py-3 font-medium">{t("name")}</th>
            <th className="px-4 py-3 font-medium">{t("email")}</th>
            <th className="px-4 py-3 font-medium">{t("active")}</th>
            <th className="px-4 py-3 font-medium">{t("permissions")}</th>
            <th className="px-4 py-3 text-right font-medium">{c("actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">{row.fullName || c("none")}</td>
              <td className="px-4 py-3">{row.email}</td>
              <td className="px-4 py-3">
                <Badge variant={row.active ? "default" : "secondary"}>
                  {row.active ? "Ja" : "Nein"}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {row.permissions.map((p) => (
                    <Badge key={p} variant="outline" className="text-xs">
                      {t(`permissionsList.${p}` as any) || p}
                    </Badge>
                  ))}
                  {row.permissions.length === 0 && (
                    <span className="text-muted-foreground">{c("none")}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/users/${row.id}/edit`}
                  className="text-primary hover:underline"
                >
                  {c("edit")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
