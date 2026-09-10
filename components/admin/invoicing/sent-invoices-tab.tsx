"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Mail, Send, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { EmailRecipientsDialog } from "../email-recipients-dialog";
import { sendInvoiceEmail } from "@/app/[locale]/admin/orders/[id]/invoice-actions";

interface SentInvoicesTabProps {
  invoices: any[];
}

export function SentInvoicesTab({ invoices }: SentInvoicesTabProps) {
  const t = useTranslations("invoicing.sentEmails");
  const tEmail = useTranslations("emailDialog");
  const [resendInvoiceId, setResendInvoiceId] = useState<string | null>(null);

  // Filter invoices that have been sent by email
  const sentInvoices = invoices.filter((inv) => inv.snapshotData?.emailSent?.sentAt);

  const handleResend = async (recipients: string[], options?: { attachTimesheets?: boolean }) => {
    if (!resendInvoiceId) return;
    try {
      await sendInvoiceEmail({
        invoiceId: resendInvoiceId,
        recipients,
        attachTimesheets: options?.attachTimesheets,
      });
      toast.success("E-Mail erfolgreich erneut versendet!");
      setResendInvoiceId(null);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim erneuten Senden");
    }
  };

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
      header: t("sentAt"),
      cell: (r) => {
        const sentAt = r.snapshotData?.emailSent?.sentAt;
        return (
          <div className="flex items-center gap-1.5 text-slate-700">
            <Send className="size-3.5 text-blue-600" />
            <span>{sentAt ? format(new Date(sentAt), "dd.MM.yyyy HH:mm") : "—"}</span>
          </div>
        );
      },
    },
    {
      header: t("recipients"),
      cell: (r) => {
        const recipients: string[] = r.snapshotData?.emailSent?.recipients || [];
        return (
          <div className="flex flex-wrap gap-1 max-w-xs">
            {recipients.map((rec, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs bg-slate-100 text-slate-700 font-normal">
                {rec}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      header: "Betrag (Brutto)",
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {Number(r.grossAmount).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
        </span>
      ),
    },
    {
      header: "Aktion",
      className: "text-end",
      action: true,
      cell: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs text-slate-700 hover:text-slate-900"
            onClick={() => window.open(`/api/invoices/${r.id}/pdf`, "_blank")}
          >
            <FileText className="size-3.5 text-emerald-600" />
            {t("viewPdf")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            onClick={() => setResendInvoiceId(r.id)}
          >
            <RefreshCw className="size-3.5" />
            {t("resend")}
          </Button>
        </div>
      ),
    },
  ];

  if (sentInvoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
        <Mail className="size-10 text-slate-300 mb-3" />
        <p className="font-medium text-slate-700">{t("empty")}</p>
        <p className="text-xs text-slate-400 mt-1">{t("subtitle")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable
          columns={columns}
          rows={sentInvoices}
          getRowKey={(r) => r.id}
          empty={null}
        />
      </div>

      <EmailRecipientsDialog
        open={!!resendInvoiceId}
        onOpenChange={(open) => {
          if (!open) setResendInvoiceId(null);
        }}
        title={tEmail("invoiceTitle")}
        invoiceId={resendInvoiceId || undefined}
        onSend={handleResend}
      />
    </div>
  );
}
