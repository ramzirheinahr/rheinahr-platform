"use client";

import { FileCheck, Download } from "lucide-react";
import { SelectAssignmentsDialog, type SelectableAssignment } from "./select-assignments-dialog";

export function OrderConfirmationsBanner({ 
  assignments,
}: { 
  assignments: SelectableAssignment[];
}) {
  const handleGenerate = async (selectedIds: string[]) => {
    if (!selectedIds.length) return;
    const url = `/api/confirmations/bulk-pdf?ids=${selectedIds.join(",")}`;
    window.open(url, "_blank");
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileCheck className="size-4 text-emerald-600" />
          Leistungsnachweise
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Laden Sie die Leistungsnachweise für die ausgewählten Schichten gesammelt als PDF herunter.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {assignments.length > 0 && (
          <SelectAssignmentsDialog
            assignments={assignments}
            title="Leistungsnachweise generieren"
            description="Wählen Sie die Schichten aus, für die ein Leistungsnachweis generiert werden soll."
            submitLabel="Generieren"
            buttonLabel="Leistungsnachweise (PDF) herunterladen"
            buttonIcon={Download}
            buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            onSubmit={handleGenerate}
          />
        )}
      </div>
    </div>
  );
}
