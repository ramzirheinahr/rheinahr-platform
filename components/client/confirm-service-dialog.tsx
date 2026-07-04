"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { SignaturePadField } from "@/components/client/signature-pad-field";
import { FileSignature, FileText, ExternalLink } from "lucide-react";
import { confirmService } from "@/app/[locale]/client/orders/actions";

// Client-side "review the document, then sign" flow (mirrors the reference
// e-signature UX): the draft Leistungsnachweis PDF is embedded for review, the
// client draws an electronic signature, consents, and the signed PDF is
// generated + archived server-side.
export function ConfirmServiceDialog({
  assignmentId,
  scheduledHours,
}: {
  assignmentId: string;
  scheduledHours: number;
}) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [hours, setHours] = useState(scheduledHours);
  const [previewHours, setPreviewHours] = useState(scheduledHours); // committed → iframe
  const [signature, setSignature] = useState("");
  const [consent, setConsent] = useState(false);

  const previewSrc = `/api/confirmations/${assignmentId}/preview?hours=${previewHours}`;
  const canSubmit = signature.length > 0 && consent && !pending;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!signature) {
      toast.error(t("signatureRequired"));
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("method", "electronic");
    startTransition(async () => {
      const res = await confirmService(formData);
      if (res.ok) {
        toast.success(t("confirmed"));
        setOpen(false);
        router.refresh();
      } else {
        const key =
          res.error === "signatureRequired"
            ? "signatureRequired"
            : res.error === "alreadyConfirmed"
              ? "alreadyConfirmed"
              : "saveError";
        toast.error(t(key));
      }
    });
  }

  // When the dialog reopens, reset the transient signing state.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSignature("");
      setConsent(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-2">
            <FileSignature className="size-4" />
            {t("confirm")}
          </Button>
        }
      />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("reviewNote")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          <input type="hidden" name="assignmentId" value={assignmentId} />

          {/* Step 1 — review the actual document */}
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

          {/* Step 2 — hours + notes */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hoursWorked">{t("hoursWorked")}</Label>
              <Input
                id="hoursWorked"
                name="hoursWorked"
                type="number"
                step="0.25"
                min={0}
                max={24}
                required
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                onBlur={() => setPreviewHours(hours)}
                className="max-w-32"
              />
              <p className="text-xs text-muted-foreground">{t("hoursPreviewHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientNotes">{t("clientNotes")}</Label>
              <Textarea
                id="clientNotes"
                name="clientNotes"
                placeholder={t("clientNotesPlaceholder")}
                className="resize-none"
                rows={3}
              />
            </div>
          </div>

          {/* Step 3 — electronic signature */}
          <section className="space-y-2">
            <Label>{t("signHere")}</Label>
            <SignaturePadField name="signatureData" onChange={setSignature} />
          </section>

          {/* Step 4 — legal consent */}
          <label className="flex items-start gap-2.5 rounded-lg border bg-muted/20 p-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="text-muted-foreground">{t("legalNote")}</span>
          </label>

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            <FileSignature className="size-4" />
            {pending ? c("loading") : t("signAndConfirm")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
