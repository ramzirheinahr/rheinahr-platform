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
import { Trash2 } from "lucide-react";
import { deleteServiceConfirmation } from "@/app/[locale]/admin/orders/[id]/confirmation-actions";

export function DeleteConfirmationDialog({
  assignmentId,
  workerName,
  hasInvoice,
}: {
  assignmentId: string;
  workerName?: string;
  hasInvoice?: boolean;
}) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteServiceConfirmation(assignmentId);
      if (res.ok) {
        toast.success(t("confirmationDeletedSuccess"));
        setOpen(false);
        router.refresh();
      } else {
        if (res.error === "cannotDeleteInvoiced") {
          toast.error(t("cannotDeleteInvoiced"));
        } else {
          toast.error(res.error || c("error"));
        }
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
            className="gap-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title={hasInvoice ? t("cannotDeleteInvoiced") : t("deleteConfirmation")}
            aria-label={t("deleteConfirmation")}
            disabled={hasInvoice}
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteConfirmationTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm text-muted-foreground">
          <p>{t("deleteConfirmationDesc")}</p>
          {workerName && (
            <p className="font-medium text-foreground">
              {c("name")}: {workerName}
            </p>
          )}
          {hasInvoice && (
            <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive font-medium">
              {t("cannotDeleteInvoiced")}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {c("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={pending || hasInvoice}
          >
            {pending ? t("deleting") : t("deleteConfirmationConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
