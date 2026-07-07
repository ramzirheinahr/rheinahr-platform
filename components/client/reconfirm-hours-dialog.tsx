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
import { FileSignature, FileText, ExternalLink } from "lucide-react";
import {
  confirmHoursCorrection,
  rejectHoursCorrection,
} from "@/app/[locale]/client/orders/actions";

// Client re-confirms admin-proposed corrected hours. Shows the updated
// Leistungsnachweis draft (with the new hours), then re-signs in Textform.
export function ReconfirmHoursDialog({
  assignmentId,
  currentHours,
  newHours,
}: {
  assignmentId: string;
  currentHours: number | null;
  newHours: number;
}) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, startTransition] = useTransition();

  const previewSrc = `/api/confirmations/${assignmentId}/preview?hours=${newHours}`;
  const canSubmit = signerName.trim().length >= 2 && consent && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      toast.error(signerName.trim().length < 2 ? t("nameRequired") : t("consentRequired"));
      return;
    }
    startTransition(async () => {
      const res = await confirmHoursCorrection({ assignmentId, signerName: signerName.trim() });
      if (res.ok) {
        toast.success(t("reconfirmed"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "nameRequired" ? t("nameRequired") : t("saveError"));
      }
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectHoursCorrection(assignmentId);
      if (res.ok) {
        toast.success(t("correctionRejected"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSignerName("");
      setConsent(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-2">
            <FileSignature className="size-4" />
            {t("reconfirmCta")}
          </Button>
        }
      />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("reconfirmTitle")}</DialogTitle>
          <DialogDescription>{t("reconfirmDesc")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <p className="text-sm">
            {currentHours != null ? (
              <>
                <span className="text-muted-foreground line-through">{currentHours}</span>{" "}
                <span aria-hidden>→</span>{" "}
              </>
            ) : null}
            <span className="font-semibold text-foreground">
              {newHours} {t("hoursWorked")}
            </span>
          </p>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="size-4 text-muted-foreground" />
                {t("documentPreview")}
              </h3>
              <a
                href={previewSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                {t("openInNewTab")}
              </a>
            </div>
            <div className="overflow-hidden rounded-lg border bg-muted/30">
              <iframe
                key={previewSrc}
                src={previewSrc}
                title={t("documentPreview")}
                className="h-[420px] w-full"
              />
            </div>
          </section>

          <div className="space-y-2">
            <Label htmlFor="reSignerName">{t("signerName")}</Label>
            <Input
              id="reSignerName"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={t("signerNamePlaceholder")}
              className="max-w-sm"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 rounded border-input"
            />
            <span>{t("reconfirmConsent")}</span>
          </label>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={reject}
              disabled={pending}
            >
              {t("rejectCorrection")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? c("loading") : t("reconfirmButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
