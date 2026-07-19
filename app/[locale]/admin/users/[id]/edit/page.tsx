import { getTranslations, getLocale } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth";
import { UserForm } from "../../user-form";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  // @ts-expect-error locale type
  await requireSuperAdmin(locale);
  const t = await getTranslations("users");
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, fullName: true, active: true, permissions: true, role: true },
  });

  if (!user || user.role !== "admin") {
    notFound();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link
          href="/admin/users"
          className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors text-muted-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-semibold">{t("edit")}</h1>
      </div>
      <UserForm user={{ ...user, fullName: user.fullName }} />
    </div>
  );
}
