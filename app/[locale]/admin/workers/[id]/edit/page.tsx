import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkerForm } from "@/components/admin/worker-form";
import { DeleteWorkerButton } from "@/components/admin/delete-worker-button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EditWorkerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("workers");
  const c = await getTranslations("common");

  const worker = await prisma.worker
    .findUnique({
      where: { id },
      include: { user: { select: { email: true } } },
    })
    .catch(() => null);

  if (!worker) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
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
          <h1 className="text-2xl font-semibold">{t("editTitle")}</h1>
        </div>
        <DeleteWorkerButton id={worker.id} />
      </div>

      <WorkerForm
        worker={{
          id: worker.id,
          fullName: worker.fullName,
          email: worker.user.email,
          qualification: worker.qualification,
          contractType: worker.contractType,
          phone: worker.phone,
          address: worker.address,
          certifications: worker.certifications,
          languages: worker.languages,
        }}
      />
    </div>
  );
}
