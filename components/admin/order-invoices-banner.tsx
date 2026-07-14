"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateOrderInvoices } from "@/app/[locale]/admin/orders/[id]/invoice-actions";

import { SelectAssignmentsDialog, type SelectableAssignment } from "./select-assignments-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trash2 } from "lucide-react";
import { deleteInvoice } from "@/app/[locale]/admin/orders/[id]/invoice-actions";

export function OrderInvoicesBanner({ 
  requestGroupId,
  invoices,
  uninvoicedAssignments
}: { 
  requestGroupId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoices: any[];
  uninvoicedAssignments: SelectableAssignment[];
}) {
  const router = useRouter();

  const handleGenerate = async (selectedIds: string[]) => {
    try {
      await generateOrderInvoices(selectedIds);
      toast.success("Rechnungen erfolgreich generiert!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Generieren der Rechnung");
    }
  };

  const handleDelete = async (invoiceId: string) => {
    if (!confirm("Möchten Sie diese Rechnung wirklich löschen? Zugehörige Schichten werden wieder freigegeben.")) return;
    try {
      await deleteInvoice(invoiceId);
      toast.success("Rechnung erfolgreich gelöscht!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Löschen der Rechnung");
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Receipt className="size-4 text-emerald-600" />
          Faktura (Rechnungen) für diese Bestellung
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {invoices.length === 0 
            ? "Noch keine Rechnungen für diese Bestellung erstellt." 
            : `${invoices.length} Rechnung(en) für diese Bestellung.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {invoices.map(inv => (
          <DropdownMenu key={inv.id}>
            <DropdownMenuTrigger render={
              <Button 
                variant="outline"
                size="sm"
                className={`gap-2 ${inv.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-slate-50 text-slate-700"}`}
              />
            }>
              {inv.status === "paid" ? <CheckCircle2 className="size-3.5" /> : <FileText className="size-3.5" />}
              {inv.invoiceNumber}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}>
                <FileText className="size-4 mr-2" />
                PDF anzeigen
              </DropdownMenuItem>
              <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleDelete(inv.id)}>
                <Trash2 className="size-4 mr-2" />
                Rechnung löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}

        {uninvoicedAssignments.length > 0 && (
          <SelectAssignmentsDialog
            assignments={uninvoicedAssignments}
            title="Rechnung erstellen"
            description="Wählen Sie die Schichten aus, für die eine Rechnung generiert werden soll."
            submitLabel="Generieren"
            buttonLabel="Fakturieren"
            buttonClassName="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
            onSubmit={handleGenerate}
          />
        )}
      </div>
    </div>
  );
}
