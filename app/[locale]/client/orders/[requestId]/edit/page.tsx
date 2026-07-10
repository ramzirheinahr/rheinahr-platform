import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isRequestEditable } from "@/lib/orders";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderRequestBuilder } from "@/components/client/order-request-builder";
import { resolveSurcharges, resolveRates, resolveNightWindow } from "@/lib/pricing";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ locale: string; requestId: string }>;
}) {
  const { locale, requestId } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");

  const user = await getCurrentUser();
  if (!user) notFound();
  const client = await prisma.client
    .findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
        surchargeNight: true,
        nightStart: true,
        nightEnd: true,
        hourlyRates: true,
      },
    })
    .catch(() => null);
  if (!client) notFound();

  const orders = await prisma.order.findMany({
    where: { requestGroupId: requestId, clientId: client.id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    select: {
      shiftDate: true,
      startTime: true,
      endTime: true,
      breakMinutes: true,
      requiredQualification: true,
      quantity: true,
      notes: true,
      status: true,
      _count: { select: { assignments: true } },
    },
  });
  if (orders.length === 0) notFound();

  // Locked once the admin has acted — send back to the read-only sheet.
  if (!isRequestEditable(orders)) {
    redirect({ href: `/client/orders/${requestId}`, locale: locale as Locale });
  }

  const initial = {
    requestGroupId: requestId,
    qual: orders[0].requiredQualification,
    shifts: orders.map((o) => ({
      date: d(o.shiftDate),
      start: o.startTime,
      end: o.endTime,
      pause: o.breakMinutes,
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
          render={<Link href={`/client/orders/${requestId}`} />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
      </div>
      <OrderRequestBuilder initial={initial} surcharges={resolveSurcharges(client)} rates={resolveRates(client)} nightWindow={resolveNightWindow(client)} />
    </div>
  );
}
