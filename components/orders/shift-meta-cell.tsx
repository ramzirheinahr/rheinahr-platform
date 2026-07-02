"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderStatusControl } from "@/components/admin/order-status-control";
import { AssignWorkerButton } from "@/components/admin/assign-worker-button";
import { ConfirmServiceDialog } from "@/components/client/confirm-service-dialog";
import { cn } from "@/lib/utils";
import { CheckCircle2, MessageSquare, Users, UserRound } from "lucide-react";
import type { AssignmentStatus, OrderStatus } from "@prisma/client";

// Per-shift pipeline data shown inside the request table, keyed like the
// builder's cells (`${date}:${slot}`). Candidates are only present in admin
// mode; the client sees the status badge alone.
export type ShiftMeta = {
  orderId: string;
  status: OrderStatus;
  quantity: number;
  label: string; // "dd.mm.yyyy · HH:mm–HH:mm" dialog heading
  isPast?: boolean;
  assignments?: {
    id: string;
    workerName?: string;
    status: AssignmentStatus;
    hours?: number | null;
    hasConfirmation?: boolean;
    worker?: {
      id: string;
      fullName: string;
      hasPhoto: boolean;
    };
  }[];
  candidates?: {
    workerId: string;
    fullName: string;
    email: string;
    status: "available" | "busy" | "unavailable";
    conflictTimes: string[];
  }[];
};

const candColor = {
  available: "text-primary",
  busy: "text-amber-600",
  unavailable: "text-destructive",
} as const;

// Client view: just the shift's pipeline status. Admin view: a compact chip
// (status + staffing count) opening a dialog with the full assignment controls,
// keeping the table itself clean.
export function ShiftMetaCell({
  meta,
  assignable = false,
}: {
  meta: ShiftMeta;
  assignable?: boolean;
}) {
  const t = useTranslations("orders");
  const eas = useTranslations("enums.assignmentStatus");

  const assignments = meta.assignments ?? [];
  const active = assignments.filter((a) => a.status !== "declined").length;

  if (!assignable) {
    const confirmedWorkers = assignments.filter((a) => a.status === "confirmed" && a.worker);
    return (
      <div className="flex flex-col gap-2 py-1">
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={meta.status} />
          {meta.quantity > 1 ? (
             <span
              className={cn(
                "inline-flex items-center gap-1 text-xs tabular-nums font-medium",
                active >= meta.quantity ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Users className="size-3.5" />
              {active}/{meta.quantity}
            </span>
          ) : null}
        </div>
        {confirmedWorkers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {confirmedWorkers.map((a) => (
              <div key={a.id} className="flex items-center gap-1 rounded-md border bg-muted/20 p-0.5 pr-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs font-medium"
                  render={<Link href={`/client/workers/${a.worker!.id}`} />}
                >
                  <div className="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
                    {a.worker!.hasPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/workers/${a.worker!.id}/photo`} alt="" className="size-full object-cover" />
                    ) : (
                      <UserRound className="size-3 text-muted-foreground" />
                    )}
                  </div>
                  {a.worker!.fullName}
                </Button>
                {meta.isPast && !a.hasConfirmation && (
                  <ConfirmServiceDialog assignmentId={a.id} />
                )}
                {meta.isPast && a.hasConfirmation && (
                  <CheckCircle2 className="size-4 text-primary" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const candidates = meta.candidates ?? [];
  const wLabel = {
    available: t("wAvailable"),
    busy: t("wBusy"),
    unavailable: t("wOff"),
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-start transition-colors hover:bg-muted"
          />
        }
      >
        <OrderStatusBadge status={meta.status} />
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs tabular-nums",
            active >= meta.quantity ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Users className="size-3.5" />
          {active}/{meta.quantity}
        </span>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{meta.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <OrderStatusControl orderId={meta.orderId} current={meta.status} />

          {assignments.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("assignedWorkers")}</h3>
              <ul className="divide-y rounded-md border">
                {assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{a.workerName}</span>
                    <div className="flex items-center gap-2">
                      {a.hours !== null ? (
                        <span className="flex items-center gap-1 text-xs text-primary">
                          <CheckCircle2 className="size-3.5" />
                          {a.hours}h
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

          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("eligibleWorkers")}</h3>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noEligible")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {candidates.map((cand) => (
                  <li
                    key={cand.workerId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
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
                      <span
                        className={cn("text-xs font-medium", candColor[cand.status])}
                      >
                        {wLabel[cand.status]}
                      </span>
                      <AssignWorkerButton
                        orderId={meta.orderId}
                        workerId={cand.workerId}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
