import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { UsersTable } from "./users-table";
import { getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const locale = await getLocale();
  // @ts-expect-error locale type
  await requireSuperAdmin(locale);
  const t = await getTranslations("users");

  const admins = await prisma.user.findMany({
    where: { role: "admin" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      fullName: true,
      active: true,
      permissions: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/admin/users/create" />} className="gap-2">
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>

      <UsersTable rows={admins} />
    </div>
  );
}
