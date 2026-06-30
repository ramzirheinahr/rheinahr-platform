import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/client/orders" />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("newOrder")}</h1>
      </div>
      <OrderRequestBuilder />
    </div>
  );
}
