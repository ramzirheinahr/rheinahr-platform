import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { resolveSurcharges, resolveRates, resolveNightWindow } from "@/lib/pricing";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  const user = await getCurrentUser();
  const client = user
    ? await prisma.client
        .findUnique({
          where: { userId: user.id },
          select: {
            surchargeSat: true,
            surchargeSun: true,
            surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
        hourlyRates: true,
          },
        })
        .catch(() => null)
    : null;

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
      <OrderRequestBuilder surcharges={resolveSurcharges(client)} rates={resolveRates(client)} nightWindow={resolveNightWindow(client)} />
    </div>
  );
}
