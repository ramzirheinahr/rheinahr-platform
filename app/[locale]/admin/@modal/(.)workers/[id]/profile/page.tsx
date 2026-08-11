import { RouteModal } from "@/components/admin/route-modal";
import AdminWorkerProfilePage from "../../../../workers/[id]/profile/page";
import { getTranslations } from "next-intl/server";

export default async function InterceptedWorkerProfilePage(props: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const t = await getTranslations("workers");
  
  return (
    <RouteModal title={t("profilePreviewTitle")}>
      <AdminWorkerProfilePage {...props} />
    </RouteModal>
  );
}
