import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkerForm } from "@/components/admin/worker-form";
import { AccountSection } from "@/components/admin/account-section";
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
  const actor = await getCurrentUser();

  const worker = await prisma.worker
    .findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, active: true, loginToken: true } },
      },
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
          qualification: worker.qualification,
          contractType: worker.contractType,
          phone: worker.phone,
          address: worker.address,
          certifications: worker.certifications,
          languages: worker.languages,
        }}
      />

      {/* Login account management (password, access link, active) — super_admin only. */}
      {actor?.role === "super_admin" && (
        <AccountSection
          userId={worker.user.id}
          email={worker.user.email}
          active={worker.user.active}
          hasLink={!!worker.user.loginToken}
        />
      )}
    </div>
  );
}
