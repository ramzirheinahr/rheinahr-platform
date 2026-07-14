"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { CheckCircle2, FileSignature, X, Download, UploadCloud, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { uploadSignedContract, deleteContract } from "@/app/[locale]/admin/orders/[id]/contract-actions";
import { useRouter } from "next/navigation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ContractAdminDialog({ contract, triggerIcon = null }: { contract: any; triggerIcon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (triggerIcon as any) || (
          <Button variant="outline" size="sm" className="gap-2">
            <FileSignature className="size-4" />
            Vertrag anzeigen
          </Button>
        )
      } />
      
      <DialogContent className="max-w-6xl sm:max-w-6xl w-[95vw] max-h-[95vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <DialogTitle className="text-xl font-normal">AÜV prüfen und signieren</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
              onClick={async () => {
                if (!confirm("Möchten Sie diesen Vertrag wirklich löschen? Zugehörige Schichten werden wieder freigegeben.")) return;
                try {
                  await deleteContract(contract.id);
                  toast.success("Vertrag erfolgreich gelöscht!");
                  setOpen(false);
                  router.refresh();
                } catch (e: unknown) {
                  toast.error((e as Error).message || "Fehler beim Löschen des Vertrags.");
                }
              }}
              title="Vertrag löschen"
            >
              <Trash2 className="size-4" />
            </Button>
            <DialogClose render={<Button variant="ghost" size="icon" className="rounded-full" />}>
              <X className="size-5" />
            </DialogClose>
          </div>
        </div>
        
        <div className="p-6 bg-slate-50 flex-1 overflow-y-auto space-y-6">
          <Tabs defaultValue="overview" className="flex flex-col">
            <TabsList className="mb-4 grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="overview">Übersicht & Vorschau</TabsTrigger>
              <TabsTrigger value="upload">Signieren & Upload</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-bold text-lg text-slate-800">Verlauf</h3>
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center text-sm gap-6 sm:gap-0">
                  <div className="flex-1 relative w-full sm:w-auto">
                    <div className="flex items-center gap-2 text-green-600 font-semibold mb-1 sm:mb-2">
                      <CheckCircle2 className="size-4" />
                      Erstellen
                    </div>
                    <p className="text-slate-500 text-xs">Von System,<br className="hidden sm:block"/>am {format(new Date(contract.createdAt), "dd.MM.yyyy 'um' HH:mm")}</p>
                    <div className="hidden sm:block absolute top-2 left-[90px] right-4 h-px bg-slate-300" />
                  </div>
                  
                  <div className="flex-1 relative w-full sm:w-auto">
                    <div className={`flex items-center gap-2 font-semibold mb-1 sm:mb-2 ${contract.status === "signed" ? "text-green-600" : "text-slate-800"}`}>
                      {contract.status === "signed" ? <CheckCircle2 className="size-4" /> : <FileSignature className="size-4" />}
                      Signieren
                    </div>
                    {contract.status === "signed" ? (
                      <p className="text-slate-500 text-xs">Signiert am {contract.signedAt ? format(new Date(contract.signedAt), "dd.MM.yyyy 'um' HH:mm") : ""}</p>
                    ) : (
                      <p className="text-slate-500 text-xs">Ausstehend</p>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="border rounded-md overflow-hidden bg-slate-800 flex flex-col h-[600px]">
                 <div className="p-3 bg-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between border-b gap-3 sm:gap-0">
                   <div className="flex items-center gap-2 text-slate-600 truncate w-full sm:w-auto">
                     <FileSignature className="size-4 shrink-0" />
                     <span className="text-sm font-medium truncate">AUV_Vertrag_{contract.id.substring(0,6)}.pdf</span>
                   </div>
                   <div className="flex gap-4 text-sm font-medium w-full sm:w-auto justify-end">
                     <a href={`/api/contracts/${contract.id}/pdf?download=true`} className="text-primary hover:underline">Download</a>
                     <button className="text-primary hover:underline" onClick={() => window.open(`/api/contracts/${contract.id}/pdf`, "_blank")}>Drucken</button>
                   </div>
                 </div>
                 <iframe src={`/api/contracts/${contract.id}/pdf`} className="w-full flex-1 border-0" title="PDF Viewer" />
              </div>
            </TabsContent>

            <TabsContent value="upload">
              {contract.status === "signed" ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                    <CheckCircle2 className="size-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-emerald-800">Vertrag wurde erfolgreich signiert</h3>
                    <p className="text-sm text-emerald-600/80 mt-1">Das unterschriebene Dokument wurde sicher hinterlegt.</p>
                  </div>
                  <a
                    href={`/api/contracts/${contract.id}/pdf?download=true`}
                    download
                    className={buttonVariants({ variant: "outline", className: "mt-4 gap-2" })}
                  >
                    <Download className="size-4" /> Signiertes PDF ansehen
                  </a>
                </div>
              ) : (
                <form action={async (formData) => {
                  formData.set("contractId", contract.id);
                  startTransition(async () => {
                     const res = await uploadSignedContract(formData);
                     if (res.ok) {
                       toast.success("Vertrag erfolgreich hochgeladen und signiert!");
                       router.refresh();
                     } else {
                       toast.error("Fehler beim Hochladen des Vertrags.");
                     }
                  });
                }} className="flex flex-col gap-6">
                  <div className="rounded-xl border bg-white p-6 shadow-sm space-y-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-slate-800">1. Vertragsvorlage herunterladen</h4>
                        <p className="text-xs text-slate-500">Generieren Sie das PDF und lassen Sie es manuell vom Kunden unterschreiben.</p>
                      </div>
                      <a
                        href={`/api/contracts/${contract.id}/pdf?download=true`}
                        download
                        className={buttonVariants({ variant: "outline", size: "sm", className: "gap-2 shrink-0" })}
                      >
                        <Download className="size-4" /> Download PDF
                      </a>
                    </div>
                    
                    <div className="border-t border-slate-100 pt-6 space-y-4">
                      <div className="space-y-1">
                        <h4 className="text-sm font-medium text-slate-800">2. Unterschriebenes Dokument hochladen</h4>
                        <p className="text-xs text-slate-500">Laden Sie das eingescannte, signierte Dokument hier hoch.</p>
                      </div>
                      <Input type="file" name="document" accept="application/pdf" required className="cursor-pointer" />
                    </div>
                  </div>
                  
                  <Button type="submit" className="w-full gap-2 bg-blue-600 hover:bg-blue-700 h-11 text-white shadow-sm" disabled={pending}>
                    <UploadCloud className="size-4" />
                    {pending ? "Wird hochgeladen..." : "Hochladen & als Signiert markieren"}
                  </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
