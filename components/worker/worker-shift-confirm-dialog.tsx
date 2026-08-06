"use client";

import { useState, useTransition, useEffect } from "react";
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
import { ShieldCheck, FileSignature } from "lucide-react";
import { confirmServiceByWorkerOnDevice } from "@/app/[locale]/worker/confirm-actions";
import { SignaturePadField } from "@/components/client/signature-pad-field";

export function WorkerShiftConfirmDialog({
  assignmentId,
  scheduledHours,
  triggerBtn
}: {
  assignmentId: string;
  scheduledHours: number;
  triggerBtn: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");
  const [signatureData, setSignatureData] = useState("");
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  
  const av = useTranslations("availability");
  const c = useTranslations("common");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signatureData) {
      toast.error("Bitte unterschreiben Sie in das Feld.");
      return;
    }
    if (!signerName.trim()) {
      toast.error("Bitte geben Sie Ihren Namen ein.");
      return;
    }

    startTransition(async () => {
      const res = await confirmServiceByWorkerOnDevice({
        assignmentId,
        signerName: signerName.trim(),
        signatureData,
        hoursWorked: scheduledHours, // default to scheduled hours
      });

      if (res.ok && res.documentUrl) {
        toast.success("Erfolgreich bestätigt!");
        setSignedPdfUrl(res.documentUrl);
      } else {
        toast.error(res.error === "alreadyConfirmed" ? "Bereits bestätigt" : "Fehler beim Bestätigen.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setTimeout(() => {
          setSignedPdfUrl(null);
          setSignerName("");
          setSignatureData("");
        }, 300);
      }
    }}>
      <DialogTrigger render={triggerBtn} />
      <DialogContent className="max-w-2xl w-[95vw] max-h-[95vh] flex flex-col p-0 overflow-hidden">
        <div className="flex flex-col h-full overflow-hidden">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>
              {signedPdfUrl ? "Leistungsnachweis bestätigt" : av("confirmShiftTitle")}
            </DialogTitle>
            <DialogDescription>
              {signedPdfUrl 
                ? "Der Leistungsnachweis wurde erfolgreich signiert." 
                : av("confirmShiftDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="h-[400px] border rounded bg-slate-100 overflow-hidden relative">
              {open && !signedPdfUrl && (
                <iframe
                  src={`/api/confirmations/${assignmentId}/blank-pdf`}
                  className="w-full h-full border-0"
                  title="PDF Vorschau"
                />
              )}
              {open && signedPdfUrl && (
                <iframe
                  src={signedPdfUrl}
                  className="w-full h-full border-0"
                  title="Signiertes PDF"
                />
              )}
            </div>

            {!signedPdfUrl && (
              <form id="worker-confirm-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signerName">{av("signerName")}</Label>
                  <Input
                    id="signerName"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Max Mustermann"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label>Unterschrift der Einrichtung</Label>
                  <SignaturePadField name="signature" onChange={setSignatureData} />
                </div>
              </form>
            )}
          </div>

          <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
            <div className="text-sm text-slate-500 flex items-center gap-1">
              <FileSignature className="size-4" />
              Sichere Signatur (Handschriftlich)
            </div>
            <div className="flex gap-2">
              {signedPdfUrl ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Schließen
                  </Button>
                  <Button type="button" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => {
                    const link = document.createElement("a");
                    link.href = signedPdfUrl;
                    link.download = `Leistungsnachweis_${signerName.replace(/\s+/g, "_")}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}>
                    PDF Herunterladen
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                    {c("cancel")}
                  </Button>
                  <Button type="submit" form="worker-confirm-form" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" disabled={pending || !signatureData || !signerName.trim()}>
                    {pending ? av("signing") : av("signShift")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
