"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";
import { swapWorker } from "@/app/[locale]/admin/orders/actions";
import { cn } from "@/lib/utils";

const candColor = {
  available: "text-primary",
  busy: "text-amber-600",
  unavailable: "text-destructive",
} as const;

export function SwapWorkerDialog({
  assignmentId,
  oldWorkerName,
  candidates,
}: {
  assignmentId: string;
  oldWorkerName?: string;
  candidates: {
    workerId: string;
    fullName: string;
    email: string;
    status: "available" | "busy" | "unavailable";
    conflictTimes: string[];
  }[];
}) {
  const t = useTranslations("orders");
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const wLabel = {
    available: t("wAvailable"),
    busy: t("wBusy"),
    unavailable: t("wOff"),
  };

  function confirmSwap(newWorkerId: string) {
    startTransition(async () => {
      const res = await swapWorker(assignmentId, newWorkerId);
      if (res.ok) {
        toast.success(t("swapSuccess"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "confirmed" ? t("cannotRemoveSigned") : t("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-blue-600 hover:text-blue-700"
            title={t("swapWorkerTitle")}
            aria-label={t("swapWorkerTitle")}
          >
            <RefreshCw className="size-4" />
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("swapWorkerTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground mb-4">
          {t("swapWorkerConfirm", { oldWorker: oldWorkerName ?? "" })}
        </p>

        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("selectReplacement")}</h3>
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
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-2"
                      disabled={pending}
                      onClick={() => confirmSwap(cand.workerId)}
                    >
                      <RefreshCw className="size-3.5" />
                      {t("swapWorker")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
