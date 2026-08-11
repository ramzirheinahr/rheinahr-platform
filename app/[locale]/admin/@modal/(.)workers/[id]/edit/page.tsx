import { RouteModal } from "@/components/admin/route-modal";
import EditWorkerPage from "../../../../workers/[id]/edit/page";
import { getTranslations } from "next-intl/server";

export default async function InterceptedWorkerEditPage(props: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getTranslations("workers");
  
  return (
    <RouteModal title={t("editTitle")}>
      <EditWorkerPage {...props} />
    </RouteModal>
  );
}
