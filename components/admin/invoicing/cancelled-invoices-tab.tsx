"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Ban, Download, Send } from "lucide-react";
import { toast } from "sonner";

export interface CancelledInvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  date: Date | string;
  grossAmount: number;
  clientId?: string | null;
  client?: {
    id?: string | null;
    facilityName?: string | null;
    [key: string]: unknown;
  } | null;
  snapshotData?: unknown;
  assignments?: unknown[];
  _count?: {
    assignments: number;
  };
  [key: string]: unknown;
}

import { getInvoiceFacilityName, hasReliableInvoiceDocument } from "@/lib/invoicing";
export { getInvoiceFacilityName, hasReliableInvoiceDocument };

interface CancelledInvoicesTabProps {
  invoices: CancelledInvoiceRow[];
}

export function CancelledInvoicesTab({ invoices }: CancelledInvoicesTabProps) {
  const t = useTranslations("invoicing");

  // Sorting state - defaults to invoice date descending
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>({ key: "date", direction: "desc" });
  const [openingId, setOpeningId] = useState<string | null>(null);

  const openStorno = async (invoiceId: string, download = false) => {
    const tab = window.open("", "_blank");
    setOpeningId(invoiceId);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/storno`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const url = `/api/invoices/${invoiceId}/storno${download ? "?download=true" : ""}`;
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : t("stornoCreationError"));
    } finally {
      setOpeningId(null);
    }
  };

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

  // Only invoices with status === "cancelled"
  const cancelledInvoices = useMemo(
    () => invoices.filter((inv) => inv.status === "cancelled"),
    [invoices]
  );

  const sortedCancelledInvoices = useMemo(() => {
    if (!sortConfig) return cancelledInvoices;
    return [...cancelledInvoices].sort((a, b) => {
      switch (sortConfig.key) {
        case "invoiceNumber": {
          const aVal = String(a.invoiceNumber || "");
          const bVal = String(b.invoiceNumber || "");
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal, undefined, { numeric: true })
            : bVal.localeCompare(aVal, undefined, { numeric: true });
        }
        case "client": {
          const aVal = getInvoiceFacilityName(a).toLowerCase();
          const bVal = getInvoiceFacilityName(b).toLowerCase();
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        case "date": {
          const aVal = new Date(a.date).getTime();
          const bVal = new Date(b.date).getTime();
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        }
        case "grossAmount": {
          const aVal = Number(a.grossAmount) || 0;
          const bVal = Number(b.grossAmount) || 0;
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        }
        case "status": {
          const aVal = String(a.status || "");
          const bVal = String(b.status || "");
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        default:
          return 0;
      }
    });
  }, [cancelledInvoices, sortConfig]);

  const columns: Column<CancelledInvoiceRow>[] = [
    {
      id: "invoiceNumber",
      sortable: true,
      header: t("invoiceNumberHeader"),
      cell: (r) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-slate-500 shrink-0" />
          <span className="font-semibold text-slate-900">{r.invoiceNumber}</span>
        </div>
      ),
    },
    {
      id: "client",
      sortable: true,
      header: t("clientFacilityHeader"),
      cell: (r) => (
        <span className="font-medium text-slate-900">
          {getInvoiceFacilityName(r)}
        </span>
      ),
    },
    {
      id: "date",
      sortable: true,
      header: t("invoiceDateHeader"),
      cell: (r) => (
        <span className="text-slate-600 text-xs">
          {format(new Date(r.date), "dd.MM.yyyy")}
        </span>
      ),
    },
    {
      id: "grossAmount",
      sortable: true,
      header: t("grossAmountHeader"),
      cell: (r) => (
        <span className="font-bold text-slate-900">
          {(-Math.abs(Number(r.grossAmount))).toLocaleString("de-DE", {
            style: "currency",
            currency: "EUR",
          })}
        </span>
      ),
    },
    {
      id: "status",
      sortable: true,
      header: t("statusHeader"),
      cell: (r) => {
        const snapshot =
          r.snapshotData && typeof r.snapshotData === "object"
            ? (r.snapshotData as Record<string, unknown>)
            : null;
        const emailSent =
          snapshot?.emailSent && typeof snapshot.emailSent === "object"
            ? (snapshot.emailSent as { sentAt?: string })
            : null;
        return (
          <div className="flex flex-col gap-1 items-start">
            <Badge variant="destructive" className="gap-1.5 opacity-90">
              <Ban className="size-3" />
              {t("cancelled")}
            </Badge>
            {emailSent?.sentAt && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 font-normal"
                title={t("sentOnTooltip", {
                  date: format(new Date(emailSent.sentAt), "dd.MM.yyyy HH:mm"),
                })}
              >
                <Send className="size-2.5 text-blue-600" />
                {t("sentViaEmailHistorical")}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      header: t("actionsHeader"),
      className: "text-end",
      action: true,
      cell: (r) => {
        const isReliable = hasReliableInvoiceDocument(r);
        return (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs text-rose-800 border-rose-200 hover:text-rose-900"
              onClick={() => void openStorno(r.id)}
              disabled={openingId === r.id}
              title={t("viewStornoPdf")}
            >
              <FileText className="size-3.5 mr-1 rtl:ml-1 rtl:mr-0" />
              {t("viewStornoPdf")}
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs"
              onClick={() => void openStorno(r.id, true)}
              disabled={openingId === r.id}
              title={t("downloadStornoPdf")}>
              <Download className="size-3.5 mr-1 rtl:ml-1 rtl:mr-0" />{t("downloadStornoPdf")}
            </Button>
            {isReliable ? <Button variant="ghost" size="sm" className="h-8 px-2.5 text-xs"
              onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}
              title={t("viewOriginalPdf")}>
              {t("viewOriginalPdf")}
            </Button> : <span className="text-xs text-amber-800" title={t("historicalPdfUnavailableTooltip")}>{t("historicalArchiveNotice")}</span>}
          </div>
        );
      },
    },
  ];

  if (cancelledInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
        <Ban className="size-10 text-slate-400 mb-3" />
        <p className="font-medium text-slate-700">{t("noCancelledInvoices")}</p>
        <p className="text-xs text-slate-500 mt-1">
          {t("noCancelledInvoicesDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">
          {cancelledInvoices.length}{" "}
          {cancelledInvoices.length === 1 ? t("cancelledInvoiceSingle") : t("cancelledInvoicePlural")}
        </span>
      </div>
      <p className="text-xs text-slate-600">{t("stornoListDescription")}</p>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable
          columns={columns}
          rows={sortedCancelledInvoices}
          getRowKey={(r) => r.id}
          sortConfig={sortConfig}
          onSort={handleSort}
          empty={null}
        />
      </div>
    </div>
  );
}
