"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle2, Clock, Receipt, Ban, Trash2, MoreHorizontal, RotateCcw, Mail } from "lucide-react";
import { toast } from "sonner";
import { toggleInvoiceStatus } from "@/app/[locale]/admin/invoicing/actions";
import { deleteInvoice, cancelInvoice, sendInvoiceEmail } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function InvoicingList({ invoices }: { invoices: any[] }) {
  const t = useTranslations("invoicing");
  const tEmail = useTranslations("emailDialog");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);

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

  const handleSendEmail = async (recipients: string[]) => {
    if (!emailInvoiceId) return;
    try {
      await sendInvoiceEmail({
        invoiceId: emailInvoiceId,
        recipients,
      });
      toast.success("E-Mail erfolgreich versendet!");
      setEmailInvoiceId(null);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Senden der E-Mail");
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const columns: Column<any>[] = [
    {
      header: "Rechnungsnr.",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{r.invoiceNumber}</span>
        </div>
      ),
    },
    {
      header: "Kunde",
      cell: (r) => (
        <span className="font-medium text-slate-900">
          {r.client?.facilityName || r.snapshotData?.facilityName || "—"}
        </span>
      ),
    },
    {
      header: "Datum",
      cell: (r) => format(new Date(r.date), "dd.MM.yyyy"),
    },
    {
      header: "Betrag (Brutto)",
      cell: (r) => (
        <span className="font-semibold">
          {Number(r.grossAmount).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <button
          onClick={() => handleToggleStatus(r.id, r.status)}
          disabled={loadingId === r.id || r.status === "cancelled"}
          className="transition-opacity hover:opacity-80 cursor-pointer disabled:cursor-not-allowed text-left"
          title={r.status === "paid" ? "Klicken, um als offen zu markieren" : r.status === "unpaid" ? "Klicken, um als bezahlt zu markieren" : undefined}
        >
          {r.status === "paid" ? (
            <Badge variant="secondary" className="gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
              <CheckCircle2 className="size-3" />
              Bezahlt
            </Badge>
          ) : r.status === "cancelled" ? (
            <Badge variant="destructive" className="gap-1.5 opacity-70">
              <Ban className="size-3" />
              Storniert
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1.5 bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100">
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
            {r.status !== "cancelled" && (
              <DropdownMenuItem onClick={() => setEmailInvoiceId(r.id)}>
                <Mail className="size-4 mr-2" />
                {tEmail("sendInvoiceEmail")}
              </DropdownMenuItem>
            )}
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

      <EmailRecipientsDialog
        open={!!emailInvoiceId}
        onOpenChange={(open) => {
          if (!open) setEmailInvoiceId(null);
        }}
        title={tEmail("invoiceTitle")}
        invoiceId={emailInvoiceId || undefined}
        onSend={handleSendEmail}
      />
    </div>
  );
}
