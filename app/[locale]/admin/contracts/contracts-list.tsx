"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Search, Edit, FileSignature, CheckCircle2, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";

export function ContractsList({ contracts, translations }: { contracts: any[], translations: any }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredContracts = contracts.filter((c) => {
    if (statusFilter === "pending" && c.status !== "pending") return false;
    if (statusFilter === "signed" && c.status !== "signed") return false;
    
    if (search) {
      const lowerSearch = search.toLowerCase();
      const clientMatch = c.client.facilityName.toLowerCase().includes(lowerSearch);
      const workerMatch = c.assignments.some((a: any) => a.worker.fullName.toLowerCase().includes(lowerSearch));
      if (!clientMatch && !workerMatch) return false;
    }
    
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 p-4 bg-white rounded-md border shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-semibold">Status:</label>
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle AÜVs</SelectItem>
              <SelectItem value="pending">AÜVs bereit zur Signatur</SelectItem>
              <SelectItem value="signed">Signierte AÜVs</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">Einsatz ab:</label>
          <div className="flex gap-2">
            <div className="flex items-center rounded-md border px-3 bg-muted/30">
              <span className="text-muted-foreground mr-2 text-sm">von</span>
              <input type="date" className="bg-transparent outline-none text-sm p-1" />
            </div>
            <div className="flex items-center rounded-md border px-3 bg-muted/30">
              <span className="text-muted-foreground mr-2 text-sm">bis</span>
              <input type="date" className="bg-transparent outline-none text-sm p-1" />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-semibold">Filter:</label>
          <Input placeholder="Niederlassung und Kunde" className="w-64" />
        </div>

        <div className="flex-1" />

        <div className="flex rounded-md border">
          <Input 
            placeholder="Suche" 
            className="border-0 focus-visible:ring-0" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="ghost" size="icon" className="rounded-none border-l">
            <Search className="size-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {filteredContracts.map((c) => {
          const firstAssignment = c.assignments[0];
          const workerName = firstAssignment?.worker.fullName || "Unbekannt";
          const qual = firstAssignment?.order.requiredQualification || "";
          
          return (
            <div key={c.id} className="border rounded-md bg-white shadow-sm overflow-hidden flex flex-col">
              <div className="flex justify-between p-4 border-b">
                <div className="flex items-center gap-4">
                  <FileSignature className="size-5 text-muted-foreground" />
                  <span className="font-bold text-lg">{workerName}</span>
                  {c.assignments.length > 1 && (
                    <span className="text-muted-foreground text-sm">+{c.assignments.length - 1} weitere</span>
                  )}
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-sm text-primary">{qual}</span>
                  <ContractAdminDialog contract={c} />
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-4 p-4 text-sm items-center">
                <div className="font-medium text-muted-foreground">{c.client.facilityName}</div>
                <div className="text-muted-foreground">{c.period}</div>
                <div className="text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-green-500" />
                  Einfache
                </div>
                <div className="flex flex-col items-end gap-2">
                  {c.status === "pending" ? (
                    <div className="flex items-center gap-1 text-primary">
                      <Clock className="size-4" />
                      <span>bitte signieren</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="size-4" />
                      <span>Signiert</span>
                    </div>
                  )}
                  <span className="text-muted-foreground text-xs">Signatur</span>
                </div>
              </div>
            </div>
          );
        })}
        {filteredContracts.length === 0 && (
          <div className="text-center p-8 text-muted-foreground border rounded-md bg-white">
            Keine Verträge gefunden.
          </div>
        )}
      </div>
    </div>
  );
}

function ContractAdminDialog({ contract }: { contract: any }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="icon" />}>
        <Edit className="size-4" />
      </DialogTrigger>
      
      <DialogContent className="max-w-6xl sm:max-w-6xl w-[95vw] max-h-[95vh] flex flex-col p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b p-4">
          <DialogTitle className="text-xl font-normal">AÜV erstellen und signieren</DialogTitle>
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
             <Button disabled={contract.status === "signed"}>Signieren</Button>
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
