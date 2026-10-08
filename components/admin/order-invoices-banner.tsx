"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, FileText, CheckCircle2, Mail, Trash2, Ban, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { generateOrderInvoices, sendInvoiceEmail, deleteInvoice, cancelInvoice, refreshInvoice } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import { useTranslations } from "next-intl";

import { SelectAssignmentsDialog, type SelectableAssignment } from "./select-assignments-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const t = useTranslations("emailDialog");
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);

  const handleGenerate = async (selectedIds: string[], customInvoiceNumber?: string) => {
    try {
      await generateOrderInvoices(selectedIds, customInvoiceNumber);
      toast.success("Rechnungen erfolgreich generiert!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Generieren der Rechnung");
    }
  };

  const handleCancel = async (invoiceId: string) => {
    if (!confirm("Möchten Sie diese Rechnung wirklich stornieren? Zugehörige Schichten werden wieder freigegeben.")) return;
    try {
      await cancelInvoice(invoiceId);
      toast.success("Rechnung erfolgreich storniert!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Stornieren der Rechnung");
    }
  };

  const handleDelete = async (invoiceId: string) => {
    if (!confirm("Möchten Sie diese Rechnung wirklich löschen? Zugehörige Schichten werden wieder freigegeben.")) return;
    try {
      await deleteInvoice(invoiceId);
      toast.success(t("deleteSuccess") || "Rechnung erfolgreich gelöscht!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Löschen der Rechnung");
    }
  };

  const handleRefresh = async (invoiceId: string) => {
    try {
      await refreshInvoice(invoiceId);
      toast.success(t("refreshSuccess"));
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Aktualisieren der Rechnung");
    }
  };

  const handleSendEmail = async (recipients: string[], options?: { attachTimesheets?: boolean }) => {
    if (!emailInvoiceId) return;
    await sendInvoiceEmail({
      invoiceId: emailInvoiceId,
      recipients,
      attachTimesheets: options?.attachTimesheets,
    });
  };

  return (
    <>
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
                  className={`gap-2 ${inv.status === "cancelled" ? "border-red-200 bg-red-50 text-red-500 hover:bg-red-100 line-through opacity-75" : inv.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                />
              }>
                {inv.status === "cancelled" ? <Ban className="size-3.5" /> : inv.status === "paid" ? <CheckCircle2 className="size-3.5" /> : <FileText className="size-3.5" />}
                {inv.invoiceNumber}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, "_blank")}>
                  <FileText className="size-4 mr-2" />
                  {t("showPdf")}
                </DropdownMenuItem>
                {inv.status !== "cancelled" && (
                  <DropdownMenuItem onClick={() => handleRefresh(inv.id)}>
                    <RotateCw className="size-4 mr-2" />
                    {t("refreshInvoice")}
                  </DropdownMenuItem>
                )}
                {inv.status !== "cancelled" && (
                  <DropdownMenuItem onClick={() => setEmailInvoiceId(inv.id)}>
                    <Mail className="size-4 mr-2" />
                    {t("sendInvoiceEmail")}
                  </DropdownMenuItem>
                )}
                {inv.status !== "cancelled" && (
                  <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleCancel(inv.id)}>
                    <Ban className="size-4 mr-2" />
                    {t("cancelInvoice")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleDelete(inv.id)}>
                  <Trash2 className="size-4 mr-2" />
                  {t("deleteInvoice")}
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

      <EmailRecipientsDialog
        open={!!emailInvoiceId}
        onOpenChange={(open) => {
          if (!open) setEmailInvoiceId(null);
        }}
        title={t("invoiceTitle")}
        requestGroupId={requestGroupId}
        invoiceId={emailInvoiceId || undefined}
        onSend={handleSendEmail}
      />
    </>
  );
}

