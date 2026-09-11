"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileCheck, Download } from "lucide-react";
import { toast } from "sonner";
import { SelectAssignmentsDialog } from "./select-assignments-dialog";
import { 
  DirectConfirmationUploadDialog, 
  type SelectableConfirmationAssignment 
} from "./direct-confirmation-upload-dialog";

export function OrderConfirmationsBanner({ 
  requestGroupId,
  assignments,
}: { 
  requestGroupId?: string;
  assignments: SelectableConfirmationAssignment[];
}) {
  const router = useRouter();
  const t = useTranslations("confirmations");

  const handleGenerate = async (selectedIds: string[]) => {
    if (!selectedIds.length) return;
    const url = `/api/confirmations/bulk-pdf?ids=${selectedIds.join(",")}`;
    window.open(url, "_blank");
  };

  const confirmedCount = assignments.filter((a) => a.hasConfirmation).length;

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileCheck className="size-4 text-emerald-600" />
          {t("title")}
          {assignments.length > 0 && (
            <span className={`text-xs font-normal px-2 py-0.5 rounded-full border ${
              confirmedCount === assignments.length
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : confirmedCount > 0
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
            }`}>
              {t("confirmedCountBadge", { confirmed: confirmedCount, total: assignments.length })}
            </span>
          )}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {confirmedCount > 0 
            ? t("bannerDescConfirmed", { confirmed: confirmedCount, total: assignments.length })
            : t("bannerDescEmpty")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {assignments.length > 0 && (
          <>
            <DirectConfirmationUploadDialog
              assignments={assignments}
              requestGroupId={requestGroupId}
            />
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
          </>
        )}
      </div>
    </div>
  );
}
