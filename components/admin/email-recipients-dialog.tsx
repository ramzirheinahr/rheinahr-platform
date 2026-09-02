"use client";

import { useState, useEffect, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Mail,
  Plus,
  X,
  Check,
  Loader2,
  FileCheck,
} from "lucide-react";
import {
  getFacilityRecipients,
  type FacilityRecipient,
} from "@/app/[locale]/admin/orders/[id]/link-actions";

export interface EmailRecipientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  requestGroupId?: string;
  contractId?: string;
  invoiceId?: string;
  clientId?: string;
  initialRecipients?: FacilityRecipient[];
  facilityName?: string;
  showAttachTimesheets?: boolean;
  onSend: (recipients: string[], options?: { attachTimesheets?: boolean }) => Promise<void>;
}

export function EmailRecipientsDialog({
  open,
  onOpenChange,
  title,
  description,
  requestGroupId,
  contractId,
  invoiceId,
  clientId,
  initialRecipients,
  facilityName: initialFacilityName,
  showAttachTimesheets,
  onSend,
}: EmailRecipientsDialogProps) {
  const t = useTranslations("emailDialog");
  const c = useTranslations("common");

  const [recipients, setRecipients] = useState<FacilityRecipient[]>(
    initialRecipients || []
  );
  const [facilityName, setFacilityName] = useState<string | undefined>(
    initialFacilityName
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customEmails, setCustomEmails] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [attachTimesheets, setAttachTimesheets] = useState(true);
  const [loading, setLoading] = useState(false);
  const [isSending, startTransition] = useTransition();

  // Load facility recipients when dialog opens
  useEffect(() => {
    if (!open) return;
    setAttachTimesheets(true);

    if (initialRecipients && initialRecipients.length > 0) {
      setRecipients(initialRecipients);
      // By default, select all active facility recipients
      setSelectedIds(new Set(initialRecipients.map((r) => r.id)));
      return;
    }

    let isMounted = true;
    setLoading(true);

    getFacilityRecipients({
      requestGroupId,
      contractId,
      invoiceId,
      clientId,
    })
      .then((res) => {
        if (!isMounted) return;
        if (res.ok && res.recipients) {
          setRecipients(res.recipients);
          if (res.facilityName) setFacilityName(res.facilityName);
          // Default select all facility recipients
          setSelectedIds(new Set(res.recipients.map((r) => r.id)));
        } else if (res.error) {
          toast.error(res.error);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        toast.error((err as Error).message || c("error"));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [open, requestGroupId, contractId, invoiceId, clientId, initialRecipients, c]);

  const toggleRecipient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(recipients.map((r) => r.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleAddCustomEmail = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (!trimmed.includes("@") || !trimmed.includes(".")) {
      toast.error(t("invalidEmail"));
      return;
    }
    if (
      customEmails.includes(trimmed) ||
      recipients.some((r) => r.email.toLowerCase() === trimmed.toLowerCase())
    ) {
      setCustomInput("");
      return;
    }
    setCustomEmails((prev) => [...prev, trimmed]);
    setCustomInput("");
  };

  const handleRemoveCustomEmail = (email: string) => {
    setCustomEmails((prev) => prev.filter((e) => e !== email));
  };

  const handleSubmit = () => {
    const chosenList = [
      ...Array.from(selectedIds),
      ...customEmails,
    ];

    if (chosenList.length === 0) {
      toast.error(t("noRecipientsSelected"));
      return;
    }

    startTransition(async () => {
      try {
        await onSend(chosenList, { attachTimesheets });
        toast.success(t("sendSuccess"));
        onOpenChange(false);
      } catch (err: unknown) {
        toast.error((err as Error).message || c("error"));
      }
    });
  };

  const allSelected =
    recipients.length > 0 && selectedIds.size === recipients.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Mail className="size-5 text-blue-600" />
            {title || t("title")}
          </DialogTitle>
          <DialogDescription>
            {description ||
              (facilityName
                ? `${t("description")} (${facilityName})`
                : t("description"))}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-3 flex-1 overflow-y-auto space-y-5">
          {/* Shift Confirmations (Leistungsnachweise) Attachment Option */}
          {Boolean(invoiceId || showAttachTimesheets) && (
            <div
              onClick={() => setAttachTimesheets((prev) => !prev)}
              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${
                attachTimesheets
                  ? "border-emerald-500/50 bg-emerald-50/40"
                  : "border-slate-200 bg-slate-50/50 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                id="attach-timesheets-toggle"
                checked={attachTimesheets}
                onChange={(e) => setAttachTimesheets(e.target.checked)}
                className="mt-0.5 size-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="space-y-0.5 select-none flex-1">
                <div className="flex items-center gap-1.5">
                  <FileCheck className="size-3.5 text-emerald-600 shrink-0" />
                  <label
                    htmlFor="attach-timesheets-toggle"
                    className="text-xs font-semibold text-slate-900 cursor-pointer block"
                  >
                    {t("attachTimesheetsLabel")}
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t("attachTimesheetsHint")}
                </p>
              </div>
            </div>
          )}

          {/* Quick Select Buttons */}
          <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
            <span className="font-medium">{t("selectRecipients")}</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                onClick={allSelected ? handleDeselectAll : handleSelectAll}
                disabled={loading || recipients.length === 0}
              >
                {allSelected ? t("deselectAll") : t("selectAll")}
              </Button>
            </div>
          </div>

          {/* Recipient List */}
          <div className="space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                <Loader2 className="size-4 animate-spin" />
                {c("loading")}
              </div>
            ) : recipients.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                Keine registrierten Benutzer gefunden.
              </div>
            ) : (
              recipients.map((r) => {
                const isChecked = selectedIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    onClick={() => toggleRecipient(r.id)}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      isChecked
                        ? "border-blue-500/50 bg-blue-50/40"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`size-4 rounded flex items-center justify-center transition-colors border ${
                          isChecked
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {isChecked && <Check className="size-3 stroke-[3]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {r.name}
                          </span>
                          {r.isPrimary ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200"
                            >
                              {t("primaryContact")}
                            </Badge>
                          ) : r.jobTitle ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-slate-600"
                            >
                              {r.jobTitle}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.email}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Custom Emails Section */}
          <div className="space-y-2 border-t pt-4">
            <label className="text-xs font-medium text-slate-700 block">
              {t("addCustomEmail")}
            </label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder={t("customEmailPlaceholder")}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddCustomEmail();
                  }
                }}
                className="text-sm h-9"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCustomEmail}
                className="shrink-0 h-9 gap-1.5"
              >
                <Plus className="size-4" />
                {c("add")}
              </Button>
            </div>

            {customEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200"
                  >
                    <Mail className="size-3 text-slate-500" />
                    {email}
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomEmail(email)}
                      className="hover:text-red-600 rounded-full p-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 bg-slate-50 border-t flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            {c("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isSending ||
              loading ||
              (selectedIds.size === 0 && customEmails.length === 0)
            }
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white min-w-[120px]"
          >
            {isSending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("sending")}
              </>
            ) : (
              <>
                <Mail className="size-4" />
                {t("sendEmail")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
