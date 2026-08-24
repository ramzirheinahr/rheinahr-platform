"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle2, Clock, Receipt, Ban, Trash2, MoreHorizontal, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { toggleInvoiceStatus } from "@/app/[locale]/admin/invoicing/actions";
import { deleteInvoice, cancelInvoice } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function InvoicingList({ invoices }: { invoices: any[] }) {
  const t = useTranslations("invoicing");
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleToggleStatus = async (id: string, currentStatus: string) => {
    if (currentStatus === "cancelled") return;
    if (currentStatus === "paid" && !confirm(t("confirmMarkUnpaid"))) return;
    setLoadingId(id);
    const newStatus = currentStatus === "paid" ? "unpaid" : "paid";
    try {
      const result = await toggleInvoiceStatus(id, newStatus);
      if (!result.ok) {
        toast.error(t("statusUpdateError"));
        return;
      }
      toast.success(newStatus === "paid" ? t("markedPaid") : t("markedUnpaid"));
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Aktualisieren");
    } finally {
      setLoadingId(null);
    }
  };

  const handleCancel = async (invoiceId: string) => {
    if (!confirm("Möchten Sie diese Rechnung wirklich stornieren? Zugehörige Schichten werden wieder freigegeben.")) return;
    setLoadingId(invoiceId);
    try {
      await cancelInvoice(invoiceId);
      toast.success("Rechnung erfolgreich storniert!");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Stornieren der Rechnung");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (invoiceId: string) => {
    if (!confirm("Möchten Sie diese Rechnung wirklich löschen? Zugehörige Schichten werden wieder freigegeben.")) return;
    setLoadingId(invoiceId);
    try {
      await deleteInvoice(invoiceId);
      toast.success("Rechnung erfolgreich gelöscht!");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Löschen der Rechnung");
    } finally {
      setLoadingId(null);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: Column<any>[] = [
    { 
      header: "Datum", 
      primary: true, 
      cell: (r) => format(new Date(r.date), "dd.MM.yyyy") 
    },
    { 
      header: "Rechnungsnr.", 
      cell: (r) => (
        <span className={`font-medium font-mono ${r.status === "cancelled" ? "line-through text-red-500 opacity-75" : "text-slate-700"}`}>
          {r.invoiceNumber}
        </span>
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
          disabled={loadingId === r.id || r.status === "cancelled"}
          className="transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {r.status === "cancelled" ? (
            <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-600 font-normal opacity-75">
              <Ban className="size-3" />
              Storniert
            </Badge>
          ) : r.status === "paid" ? (
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
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900" disabled={loadingId === r.id}>
              <MoreHorizontal className="size-4" />
            </Button>
          } />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}>
              <FileText className="size-4 mr-2" />
              PDF anzeigen
            </DropdownMenuItem>
            {r.status === "paid" && (
              <DropdownMenuItem onClick={() => handleToggleStatus(r.id, r.status)}>
                <RotateCcw className="size-4 mr-2" />
                {t("markUnpaid")}
              </DropdownMenuItem>
            )}
            {r.status === "unpaid" && (
              <DropdownMenuItem onClick={() => handleToggleStatus(r.id, r.status)}>
                <CheckCircle2 className="size-4 mr-2" />
                {t("markPaid")}
              </DropdownMenuItem>
            )}
            {r.status !== "cancelled" && (
              <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleCancel(r.id)}>
                <Ban className="size-4 mr-2" />
                Stornieren
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleDelete(r.id)}>
              <Trash2 className="size-4 mr-2" />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
