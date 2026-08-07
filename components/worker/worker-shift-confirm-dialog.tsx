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
import { netShiftHours } from "@/lib/pricing";
import { SignaturePadField } from "@/components/client/signature-pad-field";
import { PdfViewer } from "@/components/pdf-viewer";
import React from "react";

export function WorkerShiftConfirmDialog({
  assignmentId,
  initialStartTime,
  initialEndTime,
  initialBreakMinutes,
  triggerBtn
}: {
  assignmentId: string;
  initialStartTime: string;
  initialEndTime: string;
  initialBreakMinutes: number;
  triggerBtn: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");
  const [signatureData, setSignatureData] = useState("");
  const [consent, setConsent] = useState(false);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [breakMinutes, setBreakMinutes] = useState(initialBreakMinutes);

  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);
  
  const av = useTranslations("availability");
  const c = useTranslations("common");

  // Dynamic net hours for display
  const hoursWorked = React.useMemo(() => {
    return netShiftHours(startTime, endTime, breakMinutes);
  }, [startTime, endTime, breakMinutes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error("Bitte bestätigen Sie die rechtliche Erklärung.");
      return;
    }
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
        startTime,
        endTime,
        breakMinutes,
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
          setConsent(false);
        }, 300);
      }
    }}>
      <DialogTrigger render={triggerBtn} />
      <DialogContent className="max-w-2xl w-[95vw] md:w-full h-[100dvh] md:h-auto md:max-h-[90vh] flex flex-col p-0 overflow-hidden sm:rounded-lg">
        <div className="flex flex-col h-full overflow-hidden">
          <DialogHeader className="p-4 border-b bg-white z-10 shrink-0">
            <DialogTitle>
              {signedPdfUrl ? "Leistungsnachweis bestätigt" : av("confirmShiftTitle")}
            </DialogTitle>
            <DialogDescription>
              {signedPdfUrl 
                ? "Der Leistungsnachweis wurde erfolgreich signiert." 
                : av("confirmShiftDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50">
            <div className="h-[400px] md:h-[500px] border rounded bg-slate-100 overflow-hidden relative shadow-inner">
              {open && !signedPdfUrl && (
                <PdfViewer
                  url={`/api/confirmations/${assignmentId}/blank-pdf?hours=${hoursWorked}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`}
                />
              )}
              {open && signedPdfUrl && (
                <PdfViewer url={signedPdfUrl} />
              )}
            </div>

            {!signedPdfUrl && (
              <form id="worker-confirm-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startTime">Startzeit</Label>
                    <Input
                      id="startTime"
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endTime">Endzeit</Label>
                    <Input
                      id="endTime"
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="breakMinutes">Pause (Min.)</Label>
                    <Input
                      id="breakMinutes"
                      type="number"
                      min="0"
                      step="5"
                      value={breakMinutes}
                      onChange={(e) => setBreakMinutes(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>
                
                <div className="text-sm font-medium text-slate-700 bg-slate-100 p-2 rounded flex justify-between items-center">
                  <span>Berechnete Stunden:</span>
                  <span>{hoursWorked.toFixed(2)} h</span>
                </div>

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

                <div className="flex items-start space-x-2 pt-2">
                  <input
                    type="checkbox"
                    id="consent"
                    className="size-4 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <Label
                    htmlFor="consent"
                    className="text-sm font-normal leading-snug cursor-pointer"
                  >
                    Ich bestätige hiermit rechtsverbindlich, dass die oben genannte Dienstleistung erbracht wurde.
                  </Label>
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
                  <Button type="submit" form="worker-confirm-form" className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" disabled={pending || !signatureData || !consent || !signerName.trim()}>
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
