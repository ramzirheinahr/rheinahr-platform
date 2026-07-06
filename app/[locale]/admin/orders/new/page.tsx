import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { resolveSurcharges, resolveRates, resolveNightWindow } from "@/lib/pricing";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

async function getClients() {
  try {
    return await prisma.client.findMany({
      orderBy: { facilityName: "asc" },
      select: {
        id: true,
        facilityName: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
        hourlyRates: true,
      },
    });
  } catch {
    return [];
  }
}

export default async function AdminNewOrderPage() {
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const clients = await getClients();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/admin/orders" />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("newOrder")}</h1>
      </div>
      <OrderRequestBuilder
        clients={clients.map((cl) => ({
          id: cl.id,
          name: cl.facilityName,
          surcharges: resolveSurcharges(cl),
          rates: resolveRates(cl),
          night: resolveNightWindow(cl),
        }))}
      />
    </div>
  );
}
