"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Clock, CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";
import { toggleInvoiceStatus } from "@/app/[locale]/admin/invoicing/actions";
import { sendInvoiceEmail } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { EmailRecipientsDialog } from "../email-recipients-dialog";
import { hasReliableInvoiceDocument, getInvoiceFacilityName, getInvoiceDisplayGrossAmount } from "@/lib/invoicing";
import type { CancelledInvoiceRow } from "./cancelled-invoices-tab";

export type OpenInvoiceRecord = CancelledInvoiceRow;

interface OpenInvoicesTabProps {
  invoices: OpenInvoiceRecord[];
}

export function OpenInvoicesTab({ invoices }: OpenInvoicesTabProps) {
  const t = useTranslations("invoicing");
  const tEmail = useTranslations("emailDialog");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);

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

  // Filter only unpaid invoices
  const openInvoices = invoices.filter((inv) => inv.status === "unpaid");

  const sortedOpenInvoices = useMemo(() => {
    if (!sortConfig) return openInvoices;
    return [...openInvoices].sort((a, b) => {
      switch (sortConfig.key) {
        case "invoiceNumber": {
          const aVal = a.invoiceNumber || "";
          const bVal = b.invoiceNumber || "";
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
          const aVal = getInvoiceDisplayGrossAmount(a);
          const bVal = getInvoiceDisplayGrossAmount(b);
          return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
        }
        case "status": {
          const aVal = a.status || "";
          const bVal = b.status || "";
          return sortConfig.direction === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        default:
          return 0;
      }
    });
  }, [openInvoices, sortConfig]);

  const handleMarkPaid = async (id: string) => {
    setLoadingId(id);
    try {
      const result = await toggleInvoiceStatus(id, "paid");
      if (!result.ok) {
        toast.error(t("statusUpdateError"));
        return;
      }
      toast.success(t("markedPaid"));
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Aktualisieren");
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

  const selectedForEmail = openInvoices.find((i) => i.id === emailInvoiceId);

  const columns: Column<OpenInvoiceRecord>[] = [
    {
      id: "invoiceNumber",
      sortable: true,
      header: "Rechnungsnr.",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-emerald-600 shrink-0" />
          <span className="font-semibold text-slate-900">{r.invoiceNumber}</span>
        </div>
      ),
    },
    {
      id: "client",
      sortable: true,
      header: "Kunde / Einrichtung",
      cell: (r) => (
        <span className="font-medium text-slate-900">
          {getInvoiceFacilityName(r)}
        </span>
      ),
    },
    {
      id: "date",
      sortable: true,
      header: "Rechnungsdatum",
      cell: (r) => (
        <span className="text-slate-600 text-xs">
          {format(new Date(r.date), "dd.MM.yyyy")}
        </span>
      ),
    },
    {
      id: "grossAmount",
      sortable: true,
      header: "Betrag (Brutto)",
      cell: (r) => (
        <span className="font-bold text-slate-900">
          {getInvoiceDisplayGrossAmount(r).toLocaleString("de-DE", {
            style: "currency",
            currency: "EUR",
          })}
        </span>
      ),
    },
    {
      id: "status",
      sortable: true,
      header: "Status",
      cell: () => (
        <Badge
          variant="outline"
          className="gap-1 bg-amber-50 text-amber-800 border-amber-300 font-medium"
        >
          <Clock className="size-3 text-amber-600" />
          {t("unpaid")}
        </Badge>
      ),
    },
    {
      header: "Aktionen",
      className: "text-end",
      action: true,
      cell: (r) => {
        const isReliable = hasReliableInvoiceDocument(r);
        const hasDoc = isReliable || (Array.isArray(r.assignments) && r.assignments.length > 0) || (r._count && r._count.assignments > 0) || !!r.client;
        return (
          <div className="flex items-center justify-end gap-1.5">
            {hasDoc ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs text-slate-700 hover:text-slate-900"
                onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}
                title={t("viewPdf")}
              >
                <FileText className="size-3.5 text-emerald-600 mr-1 rtl:ml-1 rtl:mr-0" />
                {t("viewPdf")}
              </Button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-normal text-amber-800 bg-amber-50 border border-amber-200"
                title={t("historicalPdfUnavailableTooltip")}
              >
                <FileText className="size-3 text-amber-600 shrink-0" />
                {t("historicalArchiveNotice")}
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={!hasDoc}
              className="h-8 px-2.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setEmailInvoiceId(r.id)}
              title={!hasDoc ? t("historicalPdfUnavailableTooltip") : undefined}
            >
              <Mail className="size-3.5 mr-1 rtl:ml-1 rtl:mr-0" />
              E-Mail
            </Button>

            <Button
              size="sm"
              disabled={loadingId === r.id}
              className="h-8 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              onClick={() => handleMarkPaid(r.id)}
            >
              <CheckCircle2 className="size-3.5 mr-1 rtl:ml-1 rtl:mr-0" />
              {t("markPaid")}
            </Button>
          </div>
        );
      },
    },
  ];

  if (openInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
        <CheckCircle2 className="size-10 text-emerald-500 mb-3" />
        <p className="font-medium text-slate-700">Keine offenen Rechnungen</p>
        <p className="text-xs text-slate-500 mt-1">
          Alle ausgestellten Rechnungen in diesem Zeitraum wurden bereits als bezahlt markiert.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable
          columns={columns}
          rows={sortedOpenInvoices}
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
        clientId={selectedForEmail?.clientId || selectedForEmail?.client?.id || undefined}
        facilityName={selectedForEmail ? getInvoiceFacilityName(selectedForEmail) : undefined}
        onSend={handleSendEmail}
      />
    </div>
  );
}
