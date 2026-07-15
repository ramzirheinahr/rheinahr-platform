"use client";

import { useState, useTransition, useEffect } from "react";
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
import { ShieldCheck } from "lucide-react";
import { signContractPublic } from "@/app/[locale]/public/contract/[id]/actions";

export function PublicContractDialog({
  requestGroupId,
  contractId,
}: {
  requestGroupId: string;
  contractId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);

  // Generate signature data string on the fly for the PDF
  const [signatureData, setSignatureData] = useState("");
  useEffect(() => {
    if (signerName && consent) {
      setSignatureData(`Gezeichnet: ${signerName}\nEinwilligung erteilt\nIP protokolliert`);
    } else {
      setSignatureData("");
    }
  }, [signerName, consent]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error("Bitte stimmen Sie der elektronischen Unterschrift zu.");
      return;
    }
    if (!signerName.trim()) {
      toast.error("Bitte geben Sie Ihren Namen ein.");
      return;
    }

    startTransition(async () => {
      const res = await signContractPublic({
        requestGroupId,
        contractId,
        signerName: signerName.trim(),
        signatureData,
      });

      if (res.ok) {
        toast.success("Vertrag erfolgreich signiert!");
        // The PDF endpoint itself will now serve the signed contract because its status changed to signed!
        setSignedPdfUrl(`/api/contracts/${contractId}/pdf?requestGroupId=${requestGroupId}`);
      } else {
        toast.error("Fehler beim Signieren.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) {
        setTimeout(() => setSignedPdfUrl(null), 300);
      }
    }}>
      <DialogTrigger render={<Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" />}>
        Vertrag signieren
      </DialogTrigger>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[95vh] flex flex-col p-0 overflow-hidden">
        <div className="flex flex-col h-full overflow-hidden">
          <DialogHeader className="p-4 border-b">
            <DialogTitle>
              {signedPdfUrl ? "Vertrag signiert" : "Arbeitnehmerüberlassungsvertrag elektronisch signieren"}
            </DialogTitle>
            <DialogDescription>
              {signedPdfUrl 
                ? "Der Vertrag wurde erfolgreich signiert." 
                : "Bitte prüfen Sie die Vertragsbedingungen im PDF und unterzeichnen Sie elektronisch."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="h-[500px] border rounded bg-slate-100 overflow-hidden relative">
              {open && !signedPdfUrl && (
                <iframe
                  src={`/api/contracts/${contractId}/pdf?requestGroupId=${requestGroupId}`}
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
              <form id="contract-form" onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signerName">Name des Unterzeichners</Label>
                  <Input
                    id="signerName"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Max Mustermann"
                    required
                  />
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
                    Ich bin zeichnungsberechtigt für den Kunden und akzeptiere die Bedingungen 
                    dieses Vertrages (§ 126b BGB Textform) im Rahmen unserer Hauptvereinbarung (Rahmenvertrag). 
                    Meine IP-Adresse und der Zeitstempel werden als Signaturbeweis sicher protokolliert.
                  </Label>
                </div>
              </form>
            )}
          </div>

          <div className="p-4 border-t bg-slate-50 flex items-center justify-between">
            <div className="text-sm text-slate-500 flex items-center gap-1">
              <ShieldCheck className="size-4" />
              Sichere Signatur
            </div>
            <div className="flex gap-2">
              {signedPdfUrl ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Schließen
                  </Button>
                  <Button type="button" className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => {
                    const link = document.createElement("a");
                    link.href = signedPdfUrl + "&download=true";
                    link.download = `AUEG_Vertrag_${signerName.replace(/\s+/g, "_")}.pdf`;
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
                    Abbrechen
                  </Button>
                  <Button type="submit" form="contract-form" className="gap-2 bg-blue-600 hover:bg-blue-700" disabled={pending || !consent || !signerName.trim()}>
                    {pending ? "Wird signiert..." : "Verbindlich signieren"}
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
