import { RouteModal } from "@/components/admin/route-modal";
import EditClientPage from "../../../../clients/[id]/edit/page";
import { getTranslations } from "next-intl/server";

export default async function InterceptedClientEditPage(props: {
  params: Promise<{ id: string; locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const t = await getTranslations("clients");
  
  return (
    <RouteModal title={t("editTitle")}>
      <EditClientPage {...props} />
    </RouteModal>
  );
}
