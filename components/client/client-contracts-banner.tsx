"use client";

import { FileSignature, CheckCircle2, FileClock } from "lucide-react";
import { ContractSignDialog } from "./contract-sign-dialog";

export function ClientContractsBanner({ 
  contracts
}: { 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: any[];
}) {
  if (contracts.length === 0) return null;

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileSignature className="size-4 text-blue-600" />
          Ihre AÜV Verträge für diesen Monat
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Bitte überprüfen und signieren Sie offene Verträge.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {contracts.map(c => (
          <ContractSignDialog 
            key={c.id} 
            contract={c} 
            triggerIcon={
              <button className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors hover:bg-slate-50 ${c.status === "signed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700 animate-pulse"}`}>
                {c.status === "signed" ? <CheckCircle2 className="size-3.5" /> : <FileClock className="size-3.5" />}
                Vertrag {c.id.substring(0, 4)}...
              </button>
            } 
          />
        ))}
      </div>
    </div>
  );
}
