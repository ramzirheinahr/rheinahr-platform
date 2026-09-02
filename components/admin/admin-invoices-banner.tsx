"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Plus, FileText, CheckCircle2, Trash2, Ban, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { generateMonthInvoices } from "@/app/[locale]/admin/clients/[id]/schedule/invoice-actions";
import { deleteInvoice, cancelInvoice, sendInvoiceEmail } from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import { EmailRecipientsDialog } from "./email-recipients-dialog";
import { useTranslations } from "next-intl";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoices: any[];
  hasUninvoicedShifts: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("emailDialog");
  const [generating, setGenerating] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState("");
  const [emailInvoiceId, setEmailInvoiceId] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateMonthInvoices(clientId, year, month, customInvoiceNumber);
      toast.success("Rechnungen erfolgreich generiert!");
      setOpenDialog(false);
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Generieren der Rechnung");
    } finally {
      setGenerating(false);
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
      toast.success("Rechnung erfolgreich gelöscht!");
      router.refresh();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Löschen der Rechnung");
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
                  PDF anzeigen
                </DropdownMenuItem>
                {inv.status !== "cancelled" && (
                  <DropdownMenuItem onClick={() => setEmailInvoiceId(inv.id)}>
                    <Mail className="size-4 mr-2" />
                    {t("sendInvoiceEmail")}
                  </DropdownMenuItem>
                )}
                {inv.status !== "cancelled" && (
                  <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleCancel(inv.id)}>
                    <Ban className="size-4 mr-2" />
                    Rechnung stornieren
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-red-600 focus:text-red-700 focus:bg-red-50" onClick={() => handleDelete(inv.id)}>
                  <Trash2 className="size-4 mr-2" />
                  Rechnung löschen
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ))}

          {hasUninvoicedShifts && (
            <Dialog open={openDialog} onOpenChange={(open) => {
              setOpenDialog(open);
              if (open) setCustomInvoiceNumber("");
            }}>
              <DialogTrigger render={
                <Button size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                  <Plus className="size-4" />
                  Fakturieren
                </Button>
              } />
              <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                  <DialogTitle>Rechnung erstellen</DialogTitle>
                  <DialogDescription>
                    Erstellen Sie eine Rechnung für die bestätigten Schichten.
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <label className="text-sm font-medium mb-1.5 block">Manuelle Rechnungsnummer (Optional)</label>
                  <input
                    type="text"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder="Wird andernfalls automatisch generiert..."
                    value={customInvoiceNumber}
                    onChange={(e) => setCustomInvoiceNumber(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={generating}>
                    Abbrechen
                  </Button>
                  <Button onClick={handleGenerate} disabled={generating}>
                    {generating ? "Generiere..." : "Generieren"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <EmailRecipientsDialog
        open={!!emailInvoiceId}
        onOpenChange={(open) => {
          if (!open) setEmailInvoiceId(null);
        }}
        title={t("invoiceTitle")}
        clientId={clientId}
        invoiceId={emailInvoiceId || undefined}
        onSend={handleSendEmail}
      />
    </>
  );
}

