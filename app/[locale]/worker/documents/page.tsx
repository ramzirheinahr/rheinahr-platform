import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { WorkerPhoto } from "@/components/admin/worker-photo";
import { WorkerDocuments } from "@/components/admin/worker-documents";

export const dynamic = "force-dynamic";

// Worker self-service: manage their own profile photo and upload their
// certificates / ID / vaccination documents (admins verify them later).
export default async function WorkerDocumentsPage() {
  const t = await getTranslations("workers");
  const td = await getTranslations("portal");

  const user = await getCurrentUser();
  const worker = user
    ? await prisma.worker
        .findUnique({
          where: { userId: user.id },
          include: { documents: { orderBy: { uploadedAt: "desc" } } },
        })
        .catch(() => null)
    : null;

  if (!worker) {
    return (
      <p className="text-sm text-muted-foreground">{t("noWorkerProfile")}</p>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold">{td("documents")}</h1>

      <WorkerPhoto workerId={worker.id} hasPhoto={!!worker.photoPath} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("documentsSection")}</h2>
        <p className="text-sm text-muted-foreground">{t("workerDocumentsHint")}</p>
        <WorkerDocuments
          workerId={worker.id}
          canVerify={false}
          documents={worker.documents.map((d) => ({
            id: d.id,
            category: d.category,
            fileName: d.fileName,
            verified: d.verified,
          }))}
        />
      </section>
    </div>
  );
}
