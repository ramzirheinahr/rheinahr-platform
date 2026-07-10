"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, FileText, CheckCircle2, Clock, Receipt } from "lucide-react";
import { toast } from "sonner";
import { toggleInvoiceStatus } from "@/app/[locale]/admin/invoicing/actions";

export function InvoicingList({ invoices }: { invoices: any[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    setLoadingId(id);
    const newStatus = currentStatus === "paid" ? "unpaid" : "paid";
    try {
      await toggleInvoiceStatus(id, newStatus);
      toast.success(`Rechnung wurde als ${newStatus === "paid" ? "bezahlt" : "unbezahlt"} markiert.`);
    } catch (e: any) {
      toast.error(e.message || "Fehler beim Aktualisieren");
    } finally {
      setLoadingId(null);
    }
  };

  const columns: Column<any>[] = [
    { 
      header: "Datum", 
      primary: true, 
      cell: (r) => format(new Date(r.date), "dd.MM.yyyy") 
    },
    { 
      header: "Rechnungsnr.", 
      cell: (r) => (
        <span className="font-medium font-mono text-slate-700">{r.invoiceNumber}</span>
      ) 
    },
    { 
      header: "Einrichtung", 
      cell: (r) => r.client.facilityName 
    },
    { 
      header: "Netto", 
      className: "text-end", 
      cell: (r) => `${r.netAmount.toFixed(2).replace(".", ",")} €` 
    },
    { 
      header: "Endbetrag", 
      className: "text-end font-semibold", 
      cell: (r) => `${r.grossAmount.toFixed(2).replace(".", ",")} €` 
    },
    {
      header: "Status",
      className: "text-center",
      cell: (r) => (
        <button
          onClick={() => handleToggleStatus(r.id, r.status)}
          disabled={loadingId === r.id}
          className="transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {r.status === "paid" ? (
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 font-normal">
              <CheckCircle2 className="size-3" />
              Bezahlt
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700 font-normal">
              <Clock className="size-3" />
              Ausstehend
            </Badge>
          )}
        </button>
      )
    },
    {
      header: "Aktion",
      className: "text-end",
      action: true,
      cell: (r) => (
        <a
          href={`/api/invoices/${r.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline text-sm font-medium"
        >
          <FileText className="size-4" />
          PDF
        </a>
      ),
    },
  ];

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border rounded-lg border-dashed bg-slate-50 text-slate-500">
        <Receipt className="size-8 text-slate-400 mb-3" />
        <p>In diesem Zeitraum wurden keine Rechnungen gefunden.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable 
          columns={columns} 
          rows={invoices} 
          getRowKey={(r) => r.id}
          empty={null}
        />
      </div>
    </div>
  );
}
