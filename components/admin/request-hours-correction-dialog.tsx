"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PencilLine } from "lucide-react";
import { requestHoursCorrection } from "@/app/[locale]/client/orders/actions";

// Admin proposes corrected hours on an already client-signed shift. This does NOT
// overwrite the record — it sends a re-confirmation request to the client's inbox.
export function RequestHoursCorrectionDialog({
  assignmentId,
  currentHours,
}: {
  assignmentId: string;
  currentHours: number | null;
}) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState<string>(currentHours != null ? String(currentHours) : "");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(hours);
    if (!Number.isFinite(n) || n < 0 || n > 24) {
      toast.error(t("saveError"));
      return;
    }
    startTransition(async () => {
      const res = await requestHoursCorrection({ assignmentId, hours: n, note: note || undefined });
      if (res.ok) {
        toast.success(t("changeRequested"));
        setOpen(false);
        setNote("");
        router.refresh();
      } else {
        toast.error(
          res.error === "noChange"
            ? t("noChange")
            : res.error === "notConfirmed"
              ? t("notConfirmed")
              : t("saveError"),
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5" title={t("proposeChange")}>
            <PencilLine className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("proposeTitle")}</DialogTitle>
          <DialogDescription>{t("proposeDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {currentHours != null ? (
            <p className="text-sm text-muted-foreground">
              {t("currentHours")}: <span className="font-medium text-foreground">{currentHours}</span>
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="newHours">{t("newHours")}</Label>
            <Input
              id="newHours"
              type="number"
              step="any"
              min={0}
              max={24}
              required
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="max-w-32"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correctionNote">{t("correctionNote")}</Label>
            <Textarea
              id="correctionNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {c("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? c("loading") : t("sendRequest")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
