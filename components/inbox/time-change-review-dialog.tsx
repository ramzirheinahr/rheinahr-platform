"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, Clock, XCircle } from "lucide-react";
import {
  approveTimeChange,
  rejectTimeChange,
} from "@/app/[locale]/admin/orders/actions";

// One pending client-requested shift-window correction, prepared server-side
// (ThreadView) so the dialog opens instantly with everything on screen.
export type PendingTimeChange = {
  assignmentId: string;
  workerName: string;
  facilityName: string;
  dateLabel: string; // dd.mm.yyyy
  oldStart: string;
  oldEnd: string;
  newStart: string;
  newEnd: string;
  oldHours: number | null; // hours on the signed confirmation today
  newHours: number; // net hours of the requested window
  clientNotes: string | null;
};

// Office review of the client's "the shift actually ran …" request, right from
// the inbox thread: shows old → new window and the recomputed hours; approving
// updates the order + regenerates the signed Leistungsnachweis (Textform, so
// the admin types their name), rejecting keeps everything as is.
export function TimeChangeReviewDialog({ items }: { items: PendingTimeChange[] }) {
  const t = useTranslations("confirmations");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");

  if (items.length === 0) return null;

  function decide(assignmentId: string, approve: boolean) {
    startTransition(async () => {
      const res = approve
        ? await approveTimeChange({ assignmentId, signerName: signerName.trim() })
        : await rejectTimeChange(assignmentId);
      if (res.ok) {
        toast.success(approve ? t("timeChangeApproved") : t("timeChangeRejected"));
        if (items.length === 1) setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "nameRequired" ? t("nameRequired") : t("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="gap-2 border-amber-500/60 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800">
            <Clock className="size-4" />
            {t("reviewTimeChange", { count: items.length })}
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("timeChangeTitle")}</DialogTitle>
          <DialogDescription>{t("timeChangeDesc")}</DialogDescription>
        </DialogHeader>

        {/* Textform: the acting admin's name goes onto the regenerated PDF, so
            it is required before any approval. */}
        <div className="space-y-1.5">
          <Label htmlFor="tc-signer" className="text-xs text-muted-foreground">
            {t("timeChangeSignerHint")}
          </Label>
          <Input
            id="tc-signer"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder={t("signerName")}
            autoComplete="name"
          />
        </div>

        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.assignmentId} className="space-y-2 rounded-md border p-3">
              <div className="text-sm font-medium">
                {item.workerName} · {item.dateLabel}
              </div>
              <div className="text-xs text-muted-foreground">{item.facilityName}</div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground line-through">
                  {item.oldStart}–{item.oldEnd}
                </span>
                <span aria-hidden>→</span>
                <span className="font-semibold text-amber-700">
                  {item.newStart}–{item.newEnd}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("timeChangeHours", {
                  old: item.oldHours ?? 0,
                  new: item.newHours,
                })}
              </div>
              {item.clientNotes ? (
                <p className="text-xs text-muted-foreground">“{item.clientNotes}”</p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="h-8 flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  disabled={pending || signerName.trim().length < 2}
                  onClick={() => decide(item.assignmentId, true)}
                >
                  <CheckCircle className="size-4" />
                  {t("approveTimeChange")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 gap-1.5"
                  disabled={pending}
                  onClick={() => decide(item.assignmentId, false)}
                >
                  <XCircle className="size-4" />
                  {t("rejectTimeChange")}
                </Button>
              </div>
            </div>
          ))}
        </div>

      </DialogContent>
    </Dialog>
  );
}
