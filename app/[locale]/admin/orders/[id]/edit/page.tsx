import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveSurcharges, resolveRates } from "@/lib/pricing";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);

// Admins may edit a request at any time — no cutoff, even after shifts ran.
export default async function AdminEditRequestPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  const orders = await prisma.order.findMany({
    where: { requestGroupId: id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: {
      shiftDate: true,
      startTime: true,
      endTime: true,
      requiredQualification: true,
      quantity: true,
      notes: true,
      client: {
        select: {
          surchargeSat: true,
          surchargeSun: true,
          surchargeHoliday: true,
        hourlyRates: true,
        },
      },
    },
  });
  if (orders.length === 0) notFound();

  const initial = {
    requestGroupId: id,
    qual: orders[0].requiredQualification,
    shifts: orders.map((o) => ({
      date: d(o.shiftDate),
      start: o.startTime,
      end: o.endTime,
      quantity: o.quantity,
      bereich: o.notes ?? "",
    })),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/orders/${id}`} />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
      </div>
      <OrderRequestBuilder
        initial={initial}
        surcharges={resolveSurcharges(orders[0].client)}
        rates={resolveRates(orders[0].client)}
        adminEdit
        backHref={`/admin/orders/${id}`}
      />
    </div>
  );
}
