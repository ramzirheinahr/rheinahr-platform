import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { candidatesForShift } from "@/lib/orders";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderStatusControl } from "@/components/admin/order-status-control";
import { AssignWorkerButton } from "@/components/admin/assign-worker-button";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, MessageSquare } from "lucide-react";

export const dynamic = "force-dynamic";

const d = (date: Date) => date.toISOString().slice(0, 10);
const statusColor = {
  available: "text-primary",
  busy: "text-amber-600",
  unavailable: "text-destructive",
} as const;

export default async function AdminRequestDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const eas = await getTranslations("enums.assignmentStatus");

  const orders = await prisma.order.findMany({
    where: { requestGroupId: id },
    orderBy: [{ shiftDate: "asc" }, { startTime: "asc" }],
    include: {
      client: { select: { facilityName: true } },
      assignments: {
        include: {
          worker: { select: { fullName: true } },
          serviceConfirmation: { select: { hoursWorked: true } },
        },
      },
    },
  });
  if (orders.length === 0) notFound();

  const candidates = await Promise.all(
    orders.map((o) =>
      candidatesForShift({
        id: o.id,
        shiftDate: o.shiftDate,
        startTime: o.startTime,
        endTime: o.endTime,
        requiredQualification: o.requiredQualification,
      }),
    ),
  );

  const facility = orders[0].client.facilityName;
  const range =
    d(orders[0].shiftDate) === d(orders[orders.length - 1].shiftDate)
      ? d(orders[0].shiftDate)
      : `${d(orders[0].shiftDate)} – ${d(orders[orders.length - 1].shiftDate)}`;

  const wLabel = { available: t("wAvailable"), busy: t("wBusy"), unavailable: t("wOff") };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-2" render={<Link href="/admin/orders" />}>
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{facility}</h1>
          <p className="text-sm text-muted-foreground">
            {range} · {orders.length} {t("shiftsCount")}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {orders.map((o, i) => (
          <details key={o.id} className="group rounded-lg border">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{d(o.shiftDate)}</span>
                <span className="text-muted-foreground">{o.startTime}–{o.endTime}</span>
                <span>{eq(o.requiredQualification)}</span>
                <span className="text-muted-foreground">
                  {o.assignments.length}/{o.quantity}
                </span>
                {o.notes ? <span className="text-muted-foreground">· {o.notes}</span> : null}
              </div>
              <OrderStatusBadge status={o.status} />
            </summary>

            <div className="space-y-4 border-t p-4">
              <OrderStatusControl orderId={o.id} current={o.status} />

              {/* Assigned */}
              {o.assignments.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("assignedWorkers")}</h3>
                  <ul className="divide-y rounded-md border">
                    {o.assignments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="font-medium">{a.worker.fullName}</span>
                        <div className="flex items-center gap-2">
                          {a.serviceConfirmation ? (
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <CheckCircle2 className="size-3.5" />
                              {Number(a.serviceConfirmation.hoursWorked)}h
                            </span>
                          ) : null}
                          <Badge
                            variant={
                              a.status === "confirmed" ? "default" : a.status === "declined" ? "outline" : "secondary"
                            }
                          >
                            {eas(a.status)}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5"
                            render={<Link href={`/admin/messages/${a.id}`} />}
                          >
                            <MessageSquare className="size-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Candidates */}
              <div>
                <h3 className="mb-2 text-sm font-semibold">{t("eligibleWorkers")}</h3>
                {candidates[i].length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noEligible")}</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {candidates[i].map((cand) => (
                      <li key={cand.workerId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <div>
                          <div className="text-sm font-medium">{cand.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {cand.email}
                            {cand.status === "busy" && cand.conflictTimes.length
                              ? ` · ${cand.conflictTimes.join(", ")}`
                              : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={cn("text-xs font-medium", statusColor[cand.status])}>
                            {wLabel[cand.status]}
                          </span>
                          <AssignWorkerButton orderId={o.id} workerId={cand.workerId} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
