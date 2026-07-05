import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkerForm } from "@/components/admin/worker-form";
import { WorkerPhoto } from "@/components/admin/worker-photo";
import { WorkerDocuments } from "@/components/admin/worker-documents";
import { AccountSection } from "@/components/admin/account-section";
import { DeleteWorkerButton } from "@/components/admin/delete-worker-button";
import { ArrowLeft, Eye } from "lucide-react";

export const dynamic = "force-dynamic";

// @db.Date → "yyyy-mm-dd" for a native date input.
const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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
        documents: { orderBy: { uploadedAt: "desc" } },
      },
    })
    .catch(() => null);

  if (!worker) notFound();

  const isAdmin = actor ? actor.role === "admin" || actor.role === "super_admin" : false;

  return (
    <div className="space-y-8">
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/workers/${worker.id}/profile`} />}
          >
            <Eye className="size-4" />
            {t("viewProfile")}
          </Button>
          <DeleteWorkerButton id={worker.id} />
        </div>
      </div>

      <div className="max-w-2xl">
        <WorkerPhoto workerId={worker.id} hasPhoto={!!worker.photoPath} />
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
          skills: worker.skills,
          languages: worker.languages,
          birthDate: toDateInput(worker.birthDate),
          birthPlace: worker.birthPlace,
          nationality: worker.nationality,
          socialSecurityNumber: worker.socialSecurityNumber,
          bio: worker.bio,
          yearsExperience: worker.yearsExperience,
          employedSince: toDateInput(worker.employedSince),
          requiredHours: worker.requiredHours,
          carryoverHours: worker.carryoverHours,
        }}
      />

      <section className="max-w-2xl space-y-3">
        <h2 className="text-lg font-medium">{t("documentsSection")}</h2>
        <WorkerDocuments
          workerId={worker.id}
          canVerify={isAdmin}
          documents={worker.documents.map((d) => ({
            id: d.id,
            category: d.category,
            fileName: d.fileName,
            verified: d.verified,
          }))}
        />
      </section>

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
