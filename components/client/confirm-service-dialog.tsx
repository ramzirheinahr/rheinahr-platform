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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileSignature, FileText, ExternalLink, ShieldCheck, Clock, UploadCloud, Download } from "lucide-react";
import { confirmService } from "@/app/[locale]/client/orders/actions";

// "Review the document, then confirm" flow. The legally binding electronic
// confirmation is NOT a drawn signature (which carries no evidentiary value here)
// but a consented, timestamped record with the confirmer's name and logged IP +
// date + a legal statement on the document (§ 126a/126b BGB Textform).
export function ConfirmServiceDialog({
  assignmentId,
  scheduledHours,
  scheduledStart,
  scheduledEnd,
  isAdmin = false,
}: {
  assignmentId: string;
  scheduledHours: number;
  scheduledStart?: string;
  scheduledEnd?: string;
  isAdmin?: boolean;
}) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [hours, setHours] = useState(scheduledHours);
  const [previewHours, setPreviewHours] = useState(scheduledHours); // committed → iframe
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);

  // Optional shift-time correction (goes to the office inbox for approval).
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjStart, setAdjStart] = useState(scheduledStart ?? "");
  const [adjEnd, setAdjEnd] = useState(scheduledEnd ?? "");
  const timesChanged =
    adjustOpen &&
    Boolean(adjStart && adjEnd) &&
    (adjStart !== (scheduledStart ?? "") || adjEnd !== (scheduledEnd ?? ""));

  const previewSrc = `/api/confirmations/${assignmentId}/preview?hours=${previewHours}`;
  const canSubmit = signerName.trim().length >= 2 && consent && !pending;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (signerName.trim().length < 2) {
      toast.error(t("nameRequired"));
      return;
    }
    if (!consent) {
      toast.error(t("consentRequired"));
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("method", "electronic");
    if (!timesChanged) {
      formData.delete("adjustStart");
      formData.delete("adjustEnd");
    }
    startTransition(async () => {
      const res = await confirmService(formData);
      if (res.ok) {
        toast.success(timesChanged ? t("confirmedWithChange") : t("confirmed"));
        setOpen(false);
        router.refresh();
      } else {
        const key =
          res.error === "alreadyConfirmed"
            ? "alreadyConfirmed"
            : res.error === "nameRequired"
              ? "nameRequired"
              : "saveError";
        toast.error(t(key));
      }
    });
  }

  // When the dialog reopens, reset the transient signing state.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSignerName("");
      setConsent(false);
      setAdjustOpen(false);
      setAdjStart(scheduledStart ?? "");
      setAdjEnd(scheduledEnd ?? "");
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

        {isAdmin ? (
          <Tabs defaultValue="electronic" className="mt-2 flex flex-col">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="electronic">Elektronisch</TabsTrigger>
              <TabsTrigger value="manual">Manuell (Upload)</TabsTrigger>
            </TabsList>
            <TabsContent value="electronic">
              <form onSubmit={onSubmit} className="flex flex-col gap-5">
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
                step="any"
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

          {/* Step 2b — optional shift-time correction → office approval */}
          {scheduledStart && scheduledEnd ? (
            <section className="space-y-2 rounded-lg border p-3">
              <button
                type="button"
                onClick={() => setAdjustOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-sm font-medium"
              >
                <Clock className="size-4 text-muted-foreground" />
                {t("adjustTimesToggle")}
              </button>
              {adjustOpen ? (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted-foreground">{t("adjustTimesHint")}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="adjustStart" className="text-xs">{t("newStart")}</Label>
                      <Input
                        id="adjustStart"
                        name="adjustStart"
                        type="time"
                        value={adjStart}
                        onChange={(e) => setAdjStart(e.target.value)}
                        className="w-32"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="adjustEnd" className="text-xs">{t("newEnd")}</Label>
                      <Input
                        id="adjustEnd"
                        name="adjustEnd"
                        type="time"
                        value={adjEnd}
                        onChange={(e) => setAdjEnd(e.target.value)}
                        className="w-32"
                      />
                    </div>
                  </div>
                  {timesChanged ? (
                    <p className="text-xs text-amber-600">{t("adjustTimesApprovalNote")}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Step 3 — electronic confirmation (name + logged evidence) */}
          <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" />
              {t("eSignTitle")}
            </h3>
            <div className="space-y-2">
              <Label htmlFor="signerName">{t("signerName")}</Label>
              <Input
                id="signerName"
                name="signerName"
                required
                minLength={2}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={t("signerNamePlaceholder")}
                className="max-w-sm"
              />
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-muted-foreground">{t("legalNote")}</span>
            </label>
          </section>

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            <FileSignature className="size-4" />
            {pending ? c("loading") : t("signAndConfirm")}
          </Button>
        </form>
            </TabsContent>
            <TabsContent value="manual">
              <form onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                startTransition(async () => {
                  const res = await confirmService(fd);
                  if (res.ok) {
                    toast.success(t("confirmed"));
                    setOpen(false);
                    router.refresh();
                  } else {
                    const knownKeys = ["fileRequired", "nameRequired", "saveError", "alreadyConfirmed", "consentRequired", "forbidden"];
                    const isKnown = res.error && knownKeys.includes(res.error);
                    const errorMsg = isKnown && res.error ? t(res.error as any) : (res.error || t("saveError"));
                    toast.error(errorMsg);
                  }
                });
              }} className="flex flex-col gap-5">
                <input type="hidden" name="method" value="upload" />
                <input type="hidden" name="assignmentId" value={assignmentId} />
                <input type="hidden" name="hoursWorked" value={hours.toString()} />
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h4 className="text-sm font-medium">1. Vorlage herunterladen</h4>
                      <p className="text-xs text-muted-foreground">PDF generieren und manuell unterschreiben lassen.</p>
                    </div>
                    <a
                      href={`/api/confirmations/${assignmentId}/blank-pdf?hours=${hours}`}
                      download
                      className={buttonVariants({ variant: "outline", size: "sm", className: "gap-2" })}
                    >
                      <Download className="size-4" /> Download PDF
                    </a>
                  </div>
                  
                  <div className="border-t pt-4 space-y-3">
                    <div className="space-y-1">
                      <h4 className="text-sm font-medium">2. Unterschriebenes Dokument hochladen</h4>
                      <p className="text-xs text-muted-foreground">Das eingescannte Dokument hier hochladen.</p>
                    </div>
                    <Input type="file" name="document" accept="application/pdf" required />
                  </div>

                  <div className="border-t pt-4 space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="manualHoursWorked">{t("hoursWorked")}</Label>
                      <Input
                        id="manualHoursWorked"
                        type="number"
                        step="any"
                        min={0}
                        max={24}
                        required
                        value={hours}
                        onChange={(e) => setHours(Number(e.target.value))}
                        className="max-w-32"
                      />
                    </div>
                  </div>
                </div>
                
                <Button type="submit" className="w-full gap-2" disabled={pending}>
                  <UploadCloud className="size-4" />
                  {pending ? c("loading") : "Hochladen & Bestätigen"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        ) : (
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
                step="any"
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

          {/* Step 2b — optional shift-time correction → office approval */}
          {scheduledStart && scheduledEnd ? (
            <section className="space-y-2 rounded-lg border p-3">
              <button
                type="button"
                onClick={() => setAdjustOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-sm font-medium"
              >
                <Clock className="size-4 text-muted-foreground" />
                {t("adjustTimesToggle")}
              </button>
              {adjustOpen ? (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted-foreground">{t("adjustTimesHint")}</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="adjustStart" className="text-xs">{t("newStart")}</Label>
                      <Input
                        id="adjustStart"
                        name="adjustStart"
                        type="time"
                        value={adjStart}
                        onChange={(e) => setAdjStart(e.target.value)}
                        className="w-32"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="adjustEnd" className="text-xs">{t("newEnd")}</Label>
                      <Input
                        id="adjustEnd"
                        name="adjustEnd"
                        type="time"
                        value={adjEnd}
                        onChange={(e) => setAdjEnd(e.target.value)}
                        className="w-32"
                      />
                    </div>
                  </div>
                  {timesChanged ? (
                    <p className="text-xs text-amber-600">{t("adjustTimesApprovalNote")}</p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Step 3 — electronic confirmation (name + logged evidence) */}
          <section className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" />
              {t("eSignTitle")}
            </h3>
            <div className="space-y-2">
              <Label htmlFor="signerName">{t("signerName")}</Label>
              <Input
                id="signerName"
                name="signerName"
                required
                minLength={2}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={t("signerNamePlaceholder")}
                className="max-w-sm"
              />
            </div>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-muted-foreground">{t("legalNote")}</span>
            </label>
          </section>

          <Button type="submit" className="w-full gap-2" disabled={!canSubmit}>
            <FileSignature className="size-4" />
            {pending ? c("loading") : t("signAndConfirm")}
          </Button>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
