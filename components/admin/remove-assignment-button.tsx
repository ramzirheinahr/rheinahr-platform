"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserMinus } from "lucide-react";
import { releaseAssignment } from "@/app/[locale]/admin/schedule/actions";

// Admin withdraws a shift invitation / removes a worker from a shift. Reuses the
// full-authority release action (deletes the assignment, frees the shift back to
// the grey pool, notifies the worker). Signed Leistungsnachweise are refused
// server-side — a legal record can't be silently removed.
export function RemoveAssignmentButton({
  assignmentId,
  workerName,
}: {
  assignmentId: string;
  workerName?: string;
}) {
  const t = useTranslations("orders");
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await releaseAssignment(assignmentId);
      if (res.ok) {
        toast.success(t("invitationCancelled"));
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
            className="gap-1.5 text-destructive hover:text-destructive"
            title={t("cancelInvitation")}
            aria-label={t("cancelInvitation")}
          >
            <UserMinus className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelInvitation")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("cancelInvitationConfirm", { name: workerName ?? "" })}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {c("cancel")}
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? c("loading") : t("cancelInvitation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
