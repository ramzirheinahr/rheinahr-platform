"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { FileSignature, Plus, FileClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateMonthContracts } from "@/app/[locale]/admin/clients/[id]/schedule/actions";
import { ContractAdminDialog } from "./contract-admin-dialog";

export function ClientContractsBanner({ 
  clientId, 
  year, 
  month, 
  contracts,
  hasUncontractedShifts
}: { 
  clientId: string;
  year: number;
  month: number;
  contracts: any[];
  hasUncontractedShifts: boolean;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateMonthContracts(clientId, year, month);
      toast.success("Verträge erfolgreich generiert!");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Fehler beim Generieren der Verträge");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileSignature className="size-4 text-blue-600" />
          AÜV Verträge für diesen Monat
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {contracts.length === 0 
            ? "Noch keine Verträge für diesen Monat erstellt." 
            : `${contracts.length} Vertrag/Verträge für diesen Monat.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {contracts.map(c => (
          <ContractAdminDialog 
            key={c.id} 
            contract={c} 
            triggerIcon={
              <button className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors hover:bg-slate-50 ${c.status === "signed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                {c.status === "signed" ? <CheckCircle2 className="size-3.5" /> : <FileClock className="size-3.5" />}
                Vertrag {c.id.substring(0, 4)}...
              </button>
            } 
          />
        ))}

        {hasUncontractedShifts && (
          <Button 
            size="sm" 
            onClick={handleGenerate} 
            disabled={generating}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Plus className="size-4" />
            {generating ? "Generiere..." : "Vertrag für fehlende Schichten erstellen"}
          </Button>
        )}
      </div>
    </div>
  );
}
