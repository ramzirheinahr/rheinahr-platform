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
import { RefreshCw, AlertTriangle } from "lucide-react";
import { swapWorker } from "@/app/[locale]/admin/orders/actions";
import { cn } from "@/lib/utils";
import type { CandidateConflict } from "@/lib/orders";

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
    conflicts?: CandidateConflict[];
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

  function confirmSwap(cand: { workerId: string; fullName: string; conflicts?: CandidateConflict[] }) {
    if (cand.conflicts && cand.conflicts.length > 0) {
      const hasOverlap = cand.conflicts.some((c) => c.overlaps);
      const conflictMsg = cand.conflicts
        .map((c) => `${c.overlaps ? "⚠️ Zeitüberschneidung" : "ℹ️ Bereits eingeteilt"}: ${c.startTime}–${c.endTime} (${c.facilityName})`)
        .join("\n");
      const promptText = hasOverlap
        ? `Achtung: Zeitüberschneidung!\n\n${cand.fullName} ist zur gleichen Zeit bereits eingeteilt:\n\n${conflictMsg}\n\nMöchten Sie die Schicht trotzdem tauschen?`
        : `Achtung: ${cand.fullName} hat am selben Tag bereits folgende Schicht(en):\n\n${conflictMsg}\n\nMöchten Sie die Schicht trotzdem tauschen?`;
      
      const confirmed = window.confirm(promptText);
      if (!confirmed) return;
    }

    startTransition(async () => {
      const res = await swapWorker(assignmentId, cand.workerId);
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="text-sm font-medium text-slate-900">{cand.fullName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {cand.email}
                    </div>
                    {cand.conflicts && cand.conflicts.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {cand.conflicts.map((conf, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "text-xs flex items-center gap-1.5 font-medium px-2 py-0.5 rounded",
                              conf.overlaps
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : "bg-amber-50 text-amber-800 border border-amber-200"
                            )}
                          >
                            <AlertTriangle className="size-3 shrink-0" />
                            <span>
                              {conf.overlaps
                                ? `Zeitüberschneidung: ${conf.startTime}–${conf.endTime} (${conf.facilityName})`
                                : `Bereits eingeteilt: ${conf.startTime}–${conf.endTime} (${conf.facilityName})`}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : cand.conflictTimes && cand.conflictTimes.length > 0 ? (
                      <div className="mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">
                        <AlertTriangle className="size-3 shrink-0" />
                        <span>Bereits eingeteilt: {cand.conflictTimes.join(", ")}</span>
                      </div>
                    ) : null}
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
                      className="gap-2 shrink-0"
                      disabled={pending}
                      onClick={() => confirmSwap(cand)}
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

