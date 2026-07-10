"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCircle2, FileSignature, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";

export function ContractAdminDialog({ contract, triggerIcon = null }: { contract: any; triggerIcon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
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
          <DialogClose render={<Button variant="ghost" size="icon" className="rounded-full" />}>
            <X className="size-5" />
          </DialogClose>
        </div>
        
        <div className="p-6 bg-slate-50 flex-1 overflow-y-auto space-y-6">
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
                <div className="flex items-center gap-2 text-slate-800 font-semibold mb-1 sm:mb-2">
                  <FileSignature className="size-4" />
                  Signieren
                </div>
                {contract.status === "signed" ? (
                  <p className="text-slate-500 text-xs">Signiert am {contract.signedAt ? format(new Date(contract.signedAt), "dd.MM.yyyy 'um' HH:mm") : ""}</p>
                ) : (
                  <p className="text-slate-500 text-xs">Ausstehend</p>
                )}
                <div className="hidden sm:block absolute top-2 left-[90px] right-4 h-px bg-slate-300" />
              </div>
              
              <div className="flex-1 relative w-full sm:w-auto">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1 sm:mb-2">
                  <CheckCircle2 className="size-4" />
                  Freigeben
                </div>
                <div className="hidden sm:block absolute top-2 left-[90px] right-4 h-px bg-slate-300" />
              </div>
              
              <div className="flex-1 w-full sm:w-auto">
                <div className="flex items-center gap-2 text-slate-400 font-semibold mb-1 sm:mb-2">
                  <CheckCircle2 className="size-4" />
                  Gegensigniert
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex justify-end gap-3">
             <Button variant="outline">Ablehnen</Button>
             <Button 
               disabled={contract.status === "pending" || contract.status === "signed"}
               title={contract.status === "pending" ? "Der Kunde muss zuerst signieren" : "Bereits signiert"}
             >
               {contract.status === "pending" ? "Warten auf Kunden..." : "Signieren"}
             </Button>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
