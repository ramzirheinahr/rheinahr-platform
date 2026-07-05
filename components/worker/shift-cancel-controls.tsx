"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Check, Clock, LogOut, X } from "lucide-react";
import { requestShiftCancellation } from "@/app/[locale]/worker/assignments/actions";
import {
  approveShiftCancellation,
  rejectShiftCancellation,
  releaseAssignment,
} from "@/app/[locale]/admin/schedule/actions";

// Cancellation controls shown on a shift row of the worker hours table.
// Worker view: request to be taken off the shift (with a note) → pending.
// Admin view (`admin`): release the worker directly, and approve/reject a
// pending request. Signed / past / declined shifts expose no controls.
export function ShiftCancelControls({
  assignmentId,
  admin = false,
  status,
  signed,
  isPast,
  cancelRequested,
  cancelNote,
}: {
  assignmentId: string;
  admin?: boolean;
  status: string;
  signed: boolean;
  isPast: boolean;
  cancelRequested?: boolean;
  cancelNote?: string | null;
}) {
  const t = useTranslations("availability");
  const c = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const actionable = status !== "declined" && !signed;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "confirmed" ? t("cancelSigned") : t("saveError"));
      }
    });
  }

  // ── Admin ──
  if (admin) {
    if (!actionable) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {cancelRequested ? (
          <>
            <Badge className="gap-1 border-transparent bg-amber-500 text-white">
              <Clock className="size-3" />
              {t("cancelRequestedBadge")}
            </Badge>
            <Button
              size="sm"
              className="h-7 gap-1"
              disabled={pending}
              onClick={() => run(() => approveShiftCancellation(assignmentId), t("cancelApproved"))}
            >
              <Check className="size-3.5" />
              {t("approveCancel")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1"
              disabled={pending}
              onClick={() => run(() => rejectShiftCancellation(assignmentId), t("cancelRejected"))}
            >
              <X className="size-3.5" />
              {t("rejectCancel")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-destructive"
            disabled={pending}
            onClick={() => run(() => releaseAssignment(assignmentId), t("released"))}
          >
            <LogOut className="size-3.5" />
            {t("release")}
          </Button>
        )}
        {cancelRequested && cancelNote ? (
          <span className="w-full text-xs text-muted-foreground">“{cancelNote}”</span>
        ) : null}
      </div>
    );
  }

  // ── Worker ──
  if (!actionable || isPast) return null;
  if (cancelRequested) {
    return (
      <Badge className="gap-1 border-transparent bg-amber-500 text-white">
        <Clock className="size-3" />
        {t("cancelPending")}
      </Badge>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" variant="outline" className="h-7 gap-1 text-destructive" />}
      >
        <LogOut className="size-3.5" />
        {t("requestCancel")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("requestCancelTitle")}</DialogTitle>
          <DialogDescription>{t("requestCancelDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("cancelNoteLabel")}</label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("cancelNotePlaceholder")}
            rows={3}
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {c("cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() => run(() => requestShiftCancellation(assignmentId, note), t("cancelRequestSent"))}
          >
            {pending ? c("loading") : t("sendRequest")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
