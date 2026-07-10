"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";

export function AdminInvoicesBanner({ 
  clientId, 
  year, 
  month, 
  invoices,
  hasUninvoicedShifts
}: { 
  clientId: string;
  year: number;
  month: number;
  invoices: any[];
  hasUninvoicedShifts: boolean;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateMonthInvoices(clientId, year, month);
      toast.success("Rechnungen erfolgreich generiert!");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message || "Fehler beim Generieren der Rechnung");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Receipt className="size-4 text-emerald-600" />
          Faktura (Rechnungen) für diesen Monat
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {invoices.length === 0 
            ? "Noch keine Rechnungen für diesen Monat erstellt." 
            : `${invoices.length} Rechnung(en) für diesen Monat.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {invoices.map(inv => (
          <Button 
            key={inv.id}
            variant="outline"
            size="sm"
            className={`gap-2 ${inv.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-slate-50 text-slate-700"}`}
            onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}
          >
            {inv.status === "paid" ? <CheckCircle2 className="size-3.5" /> : <FileText className="size-3.5" />}
            {inv.invoiceNumber}
          </Button>
        ))}

        {hasUninvoicedShifts && (
          <Button 
            size="sm" 
            onClick={handleGenerate} 
            disabled={generating}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <Plus className="size-4" />
            {generating ? "Generiere..." : "Fakturieren"}
          </Button>
        )}
      </div>
    </div>
  );
}
