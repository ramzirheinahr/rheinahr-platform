import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AccountEditForm } from "@/components/admin/account-edit-form";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const actor = await requireSuperAdmin(locale as Locale);

  const t = await getTranslations("accounts");
  const c = await getTranslations("common");

  const user = await prisma.user
    .findUnique({
      where: { id },
      select: { id: true, email: true, fullName: true, role: true, active: true },
    })
    .catch(() => null);

  if (!user) notFound();

  const editable = user.role !== "super_admin" && user.id !== actor.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/admin/accounts" />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("editTitle")}</h1>
      </div>

      {editable ? (
        <AccountEditForm
          account={{
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            role: user.role as "admin" | "client" | "worker",
            active: user.active,
          }}
        />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t("selfEdit")}
        </p>
      )}
    </div>
  );
}
