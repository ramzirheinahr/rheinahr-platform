"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Plus, FileClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateOrderContracts } from "@/app/[locale]/admin/orders/[id]/contract-actions";
import { ContractAdminDialog } from "./contract-admin-dialog";
import { CopyPublicLinkButton } from "./copy-public-link-button";

import { SelectAssignmentsDialog, type SelectableAssignment } from "./select-assignments-dialog";

export function OrderContractsBanner({ 
  requestGroupId,
  contracts,
  uncontractedAssignments
}: { 
  requestGroupId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: any[];
  uncontractedAssignments: SelectableAssignment[];
}) {
  const router = useRouter();

  const handleGenerate = async (selectedIds: string[]) => {
    try {
      await generateOrderContracts(selectedIds);
      toast.success("Verträge erfolgreich generiert!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Generieren der Verträge");
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileSignature className="size-4 text-blue-600" />
          AÜV Verträge für diese Bestellung
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {contracts.length === 0 
            ? "Noch keine Verträge für diese Bestellung erstellt." 
            : `${contracts.length} Vertrag/Verträge für diese Bestellung.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {contracts.map(c => (
          <div key={c.id} className="flex items-center gap-2">
            <ContractAdminDialog 
              contract={c} 
              triggerIcon={
                <button className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors hover:bg-slate-50 ${c.status === "signed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                  {c.status === "signed" ? <CheckCircle2 className="size-3.5" /> : <FileClock className="size-3.5" />}
                  Vertrag {c.id.substring(0, 4)}...
                </button>
              } 
            />
            {c.status !== "signed" && (
              <CopyPublicLinkButton requestGroupId={requestGroupId} type="contract" contractId={c.id} />
            )}
          </div>
        ))}

        {uncontractedAssignments.length > 0 && (
          <SelectAssignmentsDialog
            assignments={uncontractedAssignments}
            title="Vertrag erstellen"
            description="Wählen Sie die Schichten aus, für die ein neuer AÜV generiert werden soll."
            submitLabel="Generieren"
            buttonLabel="Vertrag für fehlende Schichten erstellen"
            buttonClassName="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
            onSubmit={handleGenerate}
          />
        )}
      </div>
    </div>
  );
}
