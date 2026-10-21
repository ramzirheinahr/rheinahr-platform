"use client";

import { useEffect, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
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
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import {
  previewInvoiceRefresh,
  confirmInvoiceRefresh,
} from "@/app/[locale]/admin/orders/[id]/invoice-actions";
import type { V2InvoiceRefreshPreview } from "@/lib/invoice-v2-refresh-service";

interface InvoiceRefreshDialogProps {
  invoiceId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function InvoiceRefreshDialog({
  invoiceId,
  onClose,
  onSuccess,
}: InvoiceRefreshDialogProps) {
  const t = useTranslations("invoiceRefresh");
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<V2InvoiceRefreshPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const handleClose = () => {
    setPreview(null);
    setError(null);
    setReason("");
    onClose();
  };

  useEffect(() => {
    if (!invoiceId) return;

    let isMounted = true;
    startTransition(() => {
      setLoading(true);
    });

    previewInvoiceRefresh(invoiceId)
      .then((data) => {
        if (isMounted) {
          setPreview(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (isMounted) {
          const raw = (err as Error)?.message || "";
          const isMasked = raw.includes("Server Components render") || raw.includes("digest");
          const friendly = isMasked
            ? "Die Rechnung kann nicht aktualisiert werden (z. B. bereits als bezahlt markiert oder altes Rechnungsformat ohne Snapshot-Posten)."
            : raw || "Fehler beim Laden der Vorschau.";
          setError(friendly);
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [invoiceId]);

  const handleConfirm = async () => {
    if (!invoiceId || !preview) return;

    setConfirming(true);
    try {
      await confirmInvoiceRefresh(invoiceId, preview.previewToken, reason);
      toast.success(t("successMessage"));
      handleClose();
      if (onSuccess) {
        onSuccess();
      }
      router.refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || "Fehler bei der Aktualisierung.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={!!invoiceId} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">{t("loadingPreview")}</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 flex items-start gap-3 my-4">
            <AlertTriangle className="size-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">{error}</p>
            </div>
          </div>
        )}

        {!loading && preview && (
          <div className="space-y-4 my-2">
            {preview.isSent && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 flex items-start gap-2.5 text-xs">
                <AlertTriangle className="size-4 text-red-600 shrink-0 mt-0.5" />
                <p className="font-medium">{t("sentBlockedNotice")}</p>
              </div>
            )}

            {/* Header Details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-muted/40 rounded-lg text-xs">
              <div>
                <span className="text-muted-foreground block">{t("invoiceNumber")}</span>
                <span className="font-semibold">{preview.invoiceNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">{t("facility")}</span>
                <span className="font-semibold truncate block">{preview.client.facilityName}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">{t("revision")}</span>
                <span className="font-semibold">Rev. {preview.targetRevisionNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">{t("shiftCount")}</span>
                <span className="font-semibold">{preview.proposed.assignmentCount}</span>
              </div>
            </div>

            {/* Financial Comparison Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 bg-card">
                <span className="text-xs text-muted-foreground font-medium block mb-1">
                  {t("historical")}
                </span>
                <div className="text-lg font-bold">{preview.historical.formattedGross}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Netto: {preview.historical.formattedNet}
                </div>
              </div>

              <div className="border rounded-lg p-3 bg-card border-primary/40">
                <span className="text-xs text-primary font-medium block mb-1">
                  {t("proposed")}
                </span>
                <div className="text-lg font-bold text-primary">{preview.proposed.formattedGross}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Netto: {preview.proposed.formattedNet}
                </div>
              </div>

              <div className="border rounded-lg p-3 bg-card">
                <span className="text-xs text-muted-foreground font-medium block mb-1">
                  {t("difference")}
                </span>
                <div className="text-lg font-bold">{preview.proposed.formattedDiffGross}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Netto: {preview.proposed.formattedDiffNet}
                </div>
              </div>
            </div>

            {/* Line Items Preview */}
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-muted/60 text-xs font-semibold border-b">
                {t("lineItems")} ({preview.proposed.items.length})
              </div>
              <div className="max-h-48 overflow-y-auto divide-y text-xs">
                {preview.proposed.items.map((item) => (
                  <div key={item.pos} className="p-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{item.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.hours} Std. à {item.rate} €/Std.
                      </p>
                    </div>
                    <span className="font-semibold tabular-nums shrink-0">{item.amount}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Optional Reason Input */}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="refresh-reason" className="text-xs">
                {t("reasonLabel")}
              </Label>
              <Input
                id="refresh-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("reasonPlaceholder")}
                className="text-xs"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={confirming}>
            {t("cancel")}
          </Button>
          {!loading && preview && !error && (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={confirming || preview.isSent}
              className="gap-1.5"
            >
              {confirming ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("confirming")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" />
                  {t("confirmButton")}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
