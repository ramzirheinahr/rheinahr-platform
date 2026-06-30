import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderStatusControl } from "@/components/admin/order-status-control";
import { AssignWorkerButton } from "@/components/admin/assign-worker-button";
import { eligibleWorkers, type MatchCandidate } from "@/lib/matching";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const eas = await getTranslations("enums.assignmentStatus");
  const ec = await getTranslations("confirmations");

  const order = await prisma.order
    .findUnique({
      where: { id },
      include: {
        client: { select: { facilityName: true } },
        assignments: {
          include: {
            worker: {
              select: { id: true, fullName: true, user: { select: { email: true } } },
            },
            serviceConfirmation: { select: { hoursWorked: true, method: true } },
          },
        },
      },
    })
    .catch(() => null);

  if (!order) notFound();

  // Build match candidates for the shift date and run the matching engine.
  const pool = await prisma.worker.findMany({
    where: { qualification: order.requiredQualification },
    select: {
      id: true,
      fullName: true,
      qualification: true,
      user: { select: { email: true } },
      availability: { where: { date: order.shiftDate }, select: { status: true } },
      assignments: {
        where: { status: { not: "declined" }, order: { shiftDate: order.shiftDate } },
        select: { id: true },
      },
    },
  });

  const candidates: (MatchCandidate & { fullName: string; email: string })[] =
    pool.map((w) => ({
      workerId: w.id,
      qualification: w.qualification,
      unavailable: w.availability.some((a) => a.status === "unavailable"),
      alreadyAssigned: w.assignments.length > 0,
      fullName: w.fullName,
      email: w.user.email,
    }));

  const eligible = eligibleWorkers(order.requiredQualification, candidates);

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
        <h1 className="text-2xl font-semibold">{t("detailTitle")}</h1>
        <OrderStatusBadge status={order.status} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{order.client.facilityName}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <Field label={t("shiftDate")} value={order.shiftDate.toISOString().slice(0, 10)} />
          <Field label={t("shiftTime")} value={`${order.startTime}–${order.endTime}`} />
          <Field label={t("qualification")} value={eq(order.requiredQualification)} />
          <Field label={t("quantity")} value={String(order.quantity)} />
          {order.notes ? <Field label={t("notes")} value={order.notes} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("status")}</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderStatusControl orderId={order.id} current={order.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("assignedWorkers")} ({order.assignments.length} / {order.quantity})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {order.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{c("none")}</p>
          ) : (
            <ul className="divide-y">
              {order.assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium">{a.worker.fullName}</span>
                  <div className="flex items-center gap-2">
                    {a.serviceConfirmation ? (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <CheckCircle2 className="size-3.5" />
                        {Number(a.serviceConfirmation.hoursWorked)}h
                        {a.serviceConfirmation.method === "upload" ? (
                          <a
                            href={`/api/confirmations/${a.id}/document`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2"
                          >
                            {ec("viewDocument")}
                          </a>
                        ) : null}
                        <a
                          href={`/api/confirmations/${a.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {ec("pdf")}
                        </a>
                      </span>
                    ) : null}
                    <Badge
                      variant={
                        a.status === "confirmed"
                          ? "default"
                          : a.status === "declined"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {eas(a.status)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("eligibleWorkers")}</CardTitle>
        </CardHeader>
        <CardContent>
          {eligible.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noEligible")}</p>
          ) : (
            <ul className="divide-y">
              {eligible.map((w) => (
                <li key={w.workerId} className="flex items-center justify-between py-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{w.fullName}</span>
                    <span className="text-xs text-muted-foreground">{w.email}</span>
                  </div>
                  <AssignWorkerButton orderId={order.id} workerId={w.workerId} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
