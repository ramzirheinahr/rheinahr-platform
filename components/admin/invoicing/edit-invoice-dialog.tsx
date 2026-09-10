"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateInvoiceAction } from "@/app/[locale]/admin/invoicing/actions";
import { Calculator } from "lucide-react";

interface EditInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any | null;
  onSuccess?: () => void;
}

const VAT_RATE = 0.19;

export function EditInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}: EditInvoiceDialogProps) {
  const t = useTranslations("invoicing.editInvoice");
  const [loading, setLoading] = useState(false);

  // Retrieve existing adjustment and base net
  const snapshot = invoice?.snapshotData || {};
  const currentAdj = typeof snapshot.netAdjustment === "number" ? snapshot.netAdjustment : 0;
  const currentReason = snapshot.adjustmentReason || "";
  const baseNetFromSnapshot = typeof snapshot.baseNetAmount === "number" 
    ? snapshot.baseNetAmount 
    : (invoice ? invoice.netAmount - currentAdj : 0);

  const [adjustmentStr, setAdjustmentStr] = useState<string>(
    currentAdj !== 0 ? String(currentAdj) : ""
  );
  const [reason, setReason] = useState<string>(currentReason);

  const parsedAdjustment = parseFloat(adjustmentStr.replace(",", ".")) || 0;
  const newNet = Math.round((baseNetFromSnapshot + parsedAdjustment) * 100) / 100;
  const newVat = Math.round(newNet * VAT_RATE * 100) / 100;
  const newGross = Math.round((newNet + newVat) * 100) / 100;

  const handleUpdate = async () => {
    if (!invoice) return;

    if (parsedAdjustment !== 0 && !reason.trim()) {
      toast.error(t("reasonRequired"));
      return;
    }

    setLoading(true);
    try {
      await updateInvoiceAction({
        invoiceId: invoice.id,
        netAdjustment: parsedAdjustment,
        adjustmentReason: reason.trim(),
      });
      toast.success(t("success"));
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Fehler beim Aktualisieren der Rechnung");
    } finally {
      setLoading(false);
    }
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Calculator className="size-5 text-emerald-600" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border rounded-lg text-sm">
            <div>
              <span className="text-slate-500 block text-xs">{t("invoiceNumber")}</span>
              <span className="font-semibold text-slate-900">{invoice.invoiceNumber}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs">{t("client")}</span>
              <span className="font-semibold text-slate-900 truncate block">
                {invoice.client?.facilityName || snapshot.facilityName || "—"}
              </span>
            </div>
            <div className="col-span-2 pt-2 border-t border-slate-200">
              <span className="text-slate-500 block text-xs">{t("originalBaseNet")}</span>
              <span className="font-semibold text-slate-800">
                {baseNetFromSnapshot.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="netAdjustment">{t("netAdjustment")}</Label>
            <Input
              id="netAdjustment"
              type="text"
              placeholder={t("adjustmentPlaceholder")}
              value={adjustmentStr}
              onChange={(e) => setAdjustmentStr(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("netAdjustmentHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustmentReason">{t("adjustmentReason")}</Label>
            <Input
              id="adjustmentReason"
              type="text"
              placeholder={t("adjustmentReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2 text-sm">
            <span className="font-semibold text-emerald-950 block">{t("recalculatedSummary")}</span>
            <div className="flex justify-between text-slate-700">
              <span>{t("newNet")}:</span>
              <span className="font-semibold">
                {newNet.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex justify-between text-slate-700">
              <span>{t("mwst")}:</span>
              <span>
                {newVat.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex justify-between text-emerald-900 font-bold border-t border-emerald-200 pt-2 text-base">
              <span>{t("newGross")}:</span>
              <span>
                {newGross.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Abbrechen
          </Button>
          <Button onClick={handleUpdate} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? t("updating") : t("updateButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
