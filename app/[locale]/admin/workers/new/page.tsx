import { getTranslations } from "next-intl/server";
import { requireSuperAdmin } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkerCreateForm } from "@/components/admin/worker-create-form";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewWorkerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ qualification?: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale as Locale);

  const { qualification } = await searchParams;
  const initialQualification = (qualifications as readonly string[]).includes(
    qualification ?? "",
  )
    ? qualification
    : undefined;

  const allQuals = await prisma.worker.findMany({ select: { qualification: true }, distinct: ["qualification"] });
  const customQualifications = allQuals
    .map((w) => w.qualification)
    .filter((q) => !qualifications.includes(q as any));

  const t = await getTranslations("workers");
  const c = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/admin/workers" />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("new")}</h1>
      </div>
      <WorkerCreateForm
        initialQualification={initialQualification}
        customQualifications={customQualifications}
      />
    </div>
  );
}
