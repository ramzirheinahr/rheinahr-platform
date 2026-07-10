"use client";

import { Receipt, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ClientInvoicesBanner({ 
  invoices
}: { 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoices: any[];
}) {
  if (invoices.length === 0) return null;

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Receipt className="size-4 text-emerald-600" />
          Ihre Rechnungen für diesen Monat
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Laden Sie Ihre Rechnungen herunter.
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
            Rechnung {inv.invoiceNumber}
          </Button>
        ))}
      </div>
    </div>
  );
}
