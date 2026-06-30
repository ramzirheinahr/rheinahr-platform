import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { AccountCreateForm } from "@/components/admin/account-create-form";
import { ArrowLeft } from "lucide-react";
import { assignableRoles } from "@/lib/validations";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

type AssignableRole = (typeof assignableRoles)[number];

export default async function NewAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale as Locale);

  const { role } = await searchParams;
  const initialRole = (assignableRoles as readonly string[]).includes(role ?? "")
    ? (role as AssignableRole)
    : undefined;

  const t = await getTranslations("accounts");
  const c = await getTranslations("common");

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
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
      </div>
      <AccountCreateForm initialRole={initialRole} />
    </div>
  );
}
