import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { getWorkerProfileData } from "@/lib/worker-profile";
import { WorkerProfile } from "@/components/worker/worker-profile";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// Admin preview of exactly what clients see (the admin layout already gate-keeps
// the role). Reachable from the worker edit page.
export default async function AdminWorkerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("workers");
  const c = await getTranslations("common");

  const data = await getWorkerProfileData(id);
  if (!data) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/workers/${id}/edit`} />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("profilePreviewTitle")}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{t("profilePreviewHint")}</p>
      <WorkerProfile data={data} />
    </div>
  );
}
