"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle2, Clock, Receipt, Ban, Trash2, MoreHorizontal, RotateCcw, Mail, Edit3, Send, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toggleInvoiceStatus } from "@/app/[locale]/admin/invoicing/actions";
import { getInvoiceDisplayGrossAmount } from "@/lib/invoicing";
import { cancelInvoice, sendInvoiceEmail } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import { EditInvoiceDialog } from "./invoicing/edit-invoice-dialog";
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
  const searchParams = useSearchParams();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
  const [skippedBulkInvoices, setSkippedBulkInvoices] = useState<string[]>([]);
  const [skippedBulkCount, setSkippedBulkCount] = useState(0);

  // Sorting state
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>({ key: "date", direction: "desc" });

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (prev?.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedInvoices = useMemo(() => {
    if (!sortConfig) return invoices;
    return [...invoices].sort((a, b) => {
      let aVal: any = "";
      let bVal: any = "";

      switch (sortConfig.key) {
        case "invoiceNumber":
          aVal = a.invoiceNumber || "";
          bVal = b.invoiceNumber || "";
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal, undefined, { numeric: true })
            : bVal.localeCompare(aVal, undefined, { numeric: true });
        case "client":
          aVal = (a.client?.facilityName || a.snapshotData?.facilityName || "").toLowerCase();
          bVal = (b.client?.facilityName || b.snapshotData?.facilityName || "").toLowerCase();
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        case "date":
          aVal = new Date(a.date).getTime();
          bVal = new Date(b.date).getTime();
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        case "grossAmount":
          aVal = getInvoiceDisplayGrossAmount(a);
          bVal = getInvoiceDisplayGrossAmount(b);
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        case "status":
          aVal = a.status || "";
          bVal = b.status || "";
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        default:
          return 0;
      }
    });
  }, [invoices, sortConfig]);

  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const q = searchParams.get("q") || "";

  const ids = useMemo(() => {
    return invoices.map((i) => i.id).filter(Boolean);
  }, [invoices]);

  const bulkPdfUrl = useMemo(() => {
    if (ids.length > 0 && ids.length <= 100) {
      return `/api/invoices/bulk-pdf?allowPartial=true&ids=${encodeURIComponent(ids.join(","))}`;
    }
    const defFrom = "2026-07-01";
    const effectiveFrom = from || defFrom;
    return `/api/invoices/bulk-pdf?allowPartial=true&from=${encodeURIComponent(effectiveFrom)}&to=${encodeURIComponent(to)}&q=${encodeURIComponent(q)}`;
  }, [ids, from, to, q]);

  const handleDownloadBulk = async () => {
    if (invoices.length === 0 || downloadingBulk) return;
    setDownloadingBulk(true);
    setSkippedBulkInvoices([]);
    setSkippedBulkCount(0);
    try {
      const res = await fetch(bulkPdfUrl);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || t("bulkDownloadError"));
      }
      const skippedCount = Number(res.headers.get("X-Skipped-Invoice-Count") || "0");
      const skippedNumbers = JSON.parse(decodeURIComponent(res.headers.get("X-Skipped-Invoices") || "%5B%5D")) as string[];
      if (skippedCount > 0) {
        setSkippedBulkCount(skippedCount);
        setSkippedBulkInvoices(skippedNumbers);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rechnungen_${new Date().toISOString().slice(0, 10)}${skippedCount > 0 ? "_TEILWEISE" : ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      if (skippedCount > 0) {
        toast.warning(t("bulkDownloadPartial", { count: skippedCount }));
      } else {
        toast.success(t("bulkDownloadSuccess"));
      }
    } catch (e: unknown) {
      console.error("Bulk PDF download error:", e);
      toast.error((e as Error).message || t("bulkDownloadError"));
    } finally {
      setDownloadingBulk(false);
    }
  };


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


  const handleSendEmail = async (recipients: string[], options?: { attachTimesheets?: boolean }) => {
    if (!emailInvoiceId) return;
    try {
      await sendInvoiceEmail({
        invoiceId: emailInvoiceId,
        recipients,
        attachTimesheets: options?.attachTimesheets,
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
      id: "invoiceNumber",
      sortable: true,
      header: "Rechnungsnr.",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{r.invoiceNumber}</span>
        </div>
      ),
    },
    {
      id: "client",
      sortable: true,
      header: "Kunde / Einrichtung",
      cell: (r) => (
        <span className="font-medium text-slate-900">
          {r.client?.facilityName || r.snapshotData?.facilityName || "—"}
        </span>
      ),
    },
    {
      id: "date",
      sortable: true,
      header: "Rechnungsdatum",
      cell: (r) => format(new Date(r.date), "dd.MM.yyyy"),
    },
    {
      id: "grossAmount",
      sortable: true,
      header: "Betrag (Brutto)",
      cell: (r) => (
        <span className="font-semibold">
          {getInvoiceDisplayGrossAmount(r).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      id: "status",
      sortable: true,
      header: "Status",
      cell: (r) => {
        const emailSent = r.snapshotData?.emailSent;
        return (
          <div className="flex flex-col gap-1 items-start">
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

            {emailSent && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 font-normal" title={`Versendet am ${format(new Date(emailSent.sentAt), "dd.MM.yyyy HH:mm")}`}>
                <Send className="size-2.5 text-blue-600" />
                Per E-Mail versendet
              </Badge>
            )}
          </div>
        );
      }
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
              <DropdownMenuItem onClick={() => setEditingInvoice(r)}>
                <Edit3 className="size-4 mr-2" />
                Rechnung bearbeiten
              </DropdownMenuItem>
            )}
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
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
        <span className="text-sm font-medium text-slate-600">
          {invoices.length} {invoices.length === 1 ? "Rechnung" : "Rechnungen"}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={downloadingBulk || invoices.length === 0}
          className="gap-2 border-emerald-600 text-emerald-700 hover:bg-emerald-50 self-start sm:self-auto shadow-xs"
          onClick={handleDownloadBulk}
        >
          {downloadingBulk ? (
            <Loader2 className="size-4 animate-spin text-emerald-600" />
          ) : (
            <Download className="size-4 text-emerald-600" />
          )}
          <span>{downloadingBulk ? t("downloadingAllPdf") : t("downloadAllPdf")}</span>
        </Button>
      </div>

      {skippedBulkCount > 0 && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{t("bulkDownloadPartial", { count: skippedBulkCount })}</p>
          <p className="mt-1 break-words">{t("bulkDownloadSkippedNumbers")}: {skippedBulkInvoices.join(", ")}</p>
        </div>
      )}

      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable 
          columns={columns} 
          rows={sortedInvoices} 
          getRowKey={(r) => r.id}
          sortConfig={sortConfig}
          onSort={handleSort}
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

      <EditInvoiceDialog
        open={!!editingInvoice}
        onOpenChange={(open) => {
          if (!open) setEditingInvoice(null);
        }}
        invoice={editingInvoice}
      />
    </div>
  );
}
