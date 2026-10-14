"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export type InvoiceReviewResult =
  | { ok: false; code: string; message: string; diagnostics?: { assignmentId?: string; breakMinutes?: number } }
  | {
      ok: true;
      assignmentIds: string[];
      draftHash: string;
      clientName: string;
      period: string;
      items: Array<{ pos: number; description: string; hours: string; rate: string; amount: string }>;
      breakAllocations: Array<{ assignmentId: string; workerName: string; shiftDate: string; start: string; end: string; minutes: number }>;
      subtotal: string;
      taxAmount: string;
      total: string;
    };

export type SelectableAssignment = {
  id: string;
  workerName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
};

export function SelectAssignmentsDialog({
  assignments,
  title,
  description,
  submitLabel,
  buttonIcon: Icon = Plus,
  buttonLabel,
  buttonClassName,
  showSplitOption,
  requiresReview,
  onSubmit,
  clientId,
}: {
  assignments: SelectableAssignment[];
  title: string;
  description: string;
  submitLabel: string;
  buttonIcon?: LucideIcon;
  buttonLabel: string;
  buttonClassName?: string;
  showSplitOption?: boolean;
  requiresReview?: boolean;
  onSubmit: (selectedIds: string[], customInvoiceNumber?: string, splitByShift?: boolean, expectedDraftHash?: string, breakStartByAssignment?: Record<string, string>) => Promise<void | boolean>;
  clientId?: string;
}) {
  const reviewText = useTranslations("invoiceReview");
  const [open, setOpen] = useState(false);
  const [splitByShift, setSplitByShift] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(assignments.map((a) => a.id)));
  const [submitting, setSubmitting] = useState(false);
  const [customInvoiceNumber, setCustomInvoiceNumber] = useState("");
  const [workerFilter, setWorkerFilter] = useState<string>("all");
  const [review, setReview] = useState<Extract<InvoiceReviewResult, { ok: true }> | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewErrorCode, setReviewErrorCode] = useState<string | null>(null);
  const [reviewErrorAssignmentId, setReviewErrorAssignmentId] = useState<string | null>(null);
  const [breakStartByAssignment, setBreakStartByAssignment] = useState<Record<string, string>>({});
  const [breakAllocations, setBreakAllocations] = useState<Extract<InvoiceReviewResult, { ok: true }>["breakAllocations"]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [accountingConfirmed, setAccountingConfirmed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const clearReview = () => {
    setReview(null);
    setReviewError(null);
    setReviewErrorCode(null);
    setReviewErrorAssignmentId(null);
    setAccountingConfirmed(false);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(null);
  };

  const workers = Array.from(new Set(assignments.map((a) => a.workerName))).sort();
  const filteredAssignments = workerFilter === "all" 
    ? assignments 
    : assignments.filter((a) => a.workerName === workerFilter);

  const selectedShiftDates = assignments
    .filter((a) => selectedIds.has(a.id))
    .map((a) => {
      const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(a.shiftDate);
      return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
    })
    .filter((date): date is string => date !== null)
    .sort();
  const firstSelectedShiftDate = selectedShiftDates[0] ?? null;

  // Check if all filtered assignments are currently selected
  const allFilteredSelected = filteredAssignments.length > 0 && filteredAssignments.every(a => selectedIds.has(a.id));

  const toggleAssignment = (id: string) => {
    clearReview();
    setBreakAllocations([]);
    setBreakStartByAssignment((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      clearReview();
      setSelectedIds(new Set(assignments.map((a) => a.id)));
      setCustomInvoiceNumber("");
      setWorkerFilter("all");
      setSplitByShift(false);
      setBreakStartByAssignment({});
      setBreakAllocations([]);
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return;
    if (requiresReview && (!review || !pdfUrl || !accountingConfirmed)) return;
    setSubmitting(true);
    try {
      const completed = await onSubmit(Array.from(selectedIds), customInvoiceNumber, splitByShift, review?.draftHash, breakStartByAssignment);
      if (completed !== false) {
        setOpen(false);
        clearReview();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async () => {
    if (!requiresReview || selectedIds.size === 0) return;
    clearReview();
    setReviewing(true);
    try {
      const selected = Array.from(selectedIds);
      const response = await fetch("/api/invoices/v2-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ assignmentIds: selected, breakStartByAssignment }),
      });
      const payload = await response.json();
      const result: InvoiceReviewResult = response.ok ? payload : {
        ok: false,
        code: payload.error ?? "PREVIEW_FAILED",
        message: payload.message ?? reviewText("previewFailed"),
        diagnostics: payload.diagnostics,
      };
      if (!result.ok) {
        setReviewErrorCode(result.code);
        setReviewErrorAssignmentId(result.diagnostics?.assignmentId ?? null);
        if (result.diagnostics?.assignmentId && result.code === "UNRESOLVED_BREAK_ALLOCATION") {
          setReviewError("Für diese Schicht fehlt die genaue Lage der Pause. Bitte den tatsächlichen Pausenbeginn unten eintragen und die Rechnung erneut prüfen.");
        } else if (result.diagnostics?.assignmentId && result.code === "BREAK_WINDOW_OUTSIDE_SHIFT") {
          setReviewError("Die angegebene Pause liegt außerhalb der Schicht. Bitte die Uhrzeit korrigieren.");
        } else {
          setReviewError(`${result.code}: ${result.message}`);
        }
        return;
      }
      if (typeof payload.pdfBase64 !== "string") throw new Error(reviewText("previewFailed"));
      const pdfBytes = Uint8Array.from(atob(payload.pdfBase64), (char) => char.charCodeAt(0));
      setPdfUrl(URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })));
      setReview(result);
      setBreakAllocations(result.breakAllocations);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : reviewText("previewFailed"));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" className={buttonClassName} />}>
        <Icon className="size-4 mr-2" />
        {buttonLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {workers.length > 1 && (
            <div className="mb-2 flex items-center justify-between pb-2 border-b">
              <select
                className="text-sm border rounded-md px-2 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={workerFilter}
                onChange={(e) => {
                  const worker = e.target.value;
                  setWorkerFilter(worker);
                  clearReview();
                  setBreakAllocations([]);
                  setBreakStartByAssignment({});
                  if (worker !== "all") {
                    const workerIds = assignments.filter((a) => a.workerName === worker).map((a) => a.id);
                    setSelectedIds(new Set(workerIds));
                  } else {
                    setSelectedIds(new Set(assignments.map((a) => a.id)));
                  }
                }}
              >
                <option value="all">Alle Mitarbeiter</option>
                {workers.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
              
              <Button 
                type="button" 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  clearReview();
                  setBreakAllocations([]);
                  setBreakStartByAssignment({});
                  if (allFilteredSelected) {
                    const next = new Set(selectedIds);
                    filteredAssignments.forEach(a => next.delete(a.id));
                    setSelectedIds(next);
                  } else {
                    const next = new Set(selectedIds);
                    filteredAssignments.forEach(a => next.add(a.id));
                    setSelectedIds(next);
                  }
                }}
              >
                {allFilteredSelected ? "Auswahl aufheben" : "Alle auswählen"}
              </Button>
            </div>
          )}
          
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {filteredAssignments.map((a) => (
              <div key={a.id} className="flex items-center space-x-3 rounded-md border p-3 hover:bg-slate-50 transition-colors">
              <input
                type="checkbox"
                id={`assign-${a.id}`}
                className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                checked={selectedIds.has(a.id)}
                onChange={() => toggleAssignment(a.id)}
              />
              <div className="space-y-1 leading-none">
                <label
                  htmlFor={`assign-${a.id}`}
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  {a.workerName}
                </label>
                <p className="text-xs text-muted-foreground">
                  {a.shiftDate} · {a.startTime} - {a.endTime}
                </p>
              </div>
            </div>
          ))}
        </div>
        </div>

        <div className="px-1 py-2">
          <label className="text-sm font-medium mb-1.5 block">Manuelle Rechnungsnummer (Optional)</label>
          <input
            type="text"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Wird andernfalls automatisch generiert..."
            value={customInvoiceNumber}
            onChange={(e) => setCustomInvoiceNumber(e.target.value)}
          />
        </div>

        {showSplitOption && (
          <div className="px-1 py-1 flex items-center space-x-2">
            <input
              type="checkbox"
              id="split-contract"
              className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
              checked={splitByShift}
              onChange={(e) => setSplitByShift(e.target.checked)}
            />
            <label htmlFor="split-contract" className="text-sm font-medium cursor-pointer">
              Verträge pro Schicht trennen (als Einzelseiten im selben PDF)
            </label>
          </div>
        )}

        {requiresReview && (
          <div className="space-y-3 rounded-md border p-3">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={reviewing || submitting || selectedIds.size === 0}>
              {reviewing ? reviewText("loading") : reviewText("calculate")}
            </Button>
            {breakAllocations.length > 0 && (
              <details className="rounded-md border p-2 text-sm">
                <summary className="cursor-pointer font-medium">Pausenzeiten prüfen oder ändern ({breakAllocations.length})</summary>
                <p className="mt-2 text-xs text-muted-foreground">Standardmäßig liegt jede Pause in der Mitte der Schicht. Falls die tatsächliche Pause anders lag, die Uhrzeit ändern und die Vorschau erneut berechnen.</p>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {breakAllocations.map((allocation) => (
                    <label key={allocation.assignmentId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                      <span>{allocation.workerName} · {allocation.shiftDate} · {allocation.minutes} Min.</span>
                      <input
                        type="time"
                        className="rounded border px-2 py-1"
                        value={breakStartByAssignment[allocation.assignmentId] ?? allocation.start}
                        onChange={(event) => {
                          setBreakStartByAssignment((current) => ({ ...current, [allocation.assignmentId]: event.target.value }));
                          clearReview();
                        }}
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
            {reviewError && (
              <div role="alert" className="space-y-2 text-sm text-red-700 break-words">
                <p>{reviewError}</p>
                {clientId && firstSelectedShiftDate &&
                  (reviewErrorCode === "POLICY_UNRESOLVED" || reviewErrorCode === "PRICE_UNRESOLVED") && (
                    <Link
                      href={`/admin/clients/${clientId}/rates?from=${firstSelectedShiftDate}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-medium underline underline-offset-2"
                    >
                      Vergütung und Zuschläge für den Abrechnungszeitraum prüfen
                    </Link>
                  )}
                {reviewErrorCode && ["UNRESOLVED_BREAK_ALLOCATION", "BREAK_WINDOW_OUTSIDE_SHIFT", "INVALID_BREAK_DURATION", "INVALID_TIME_FORMAT", "INVALID_TIME_INTERVAL"].includes(reviewErrorCode) && reviewErrorAssignmentId &&
                  selectedIds.has(reviewErrorAssignmentId) && (() => {
                    const shift = assignments.find((a) => a.id === reviewErrorAssignmentId);
                    return (
                      <label className="block rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950">
                        <span className="block font-medium">Tatsächlicher Pausenbeginn für {shift?.workerName ?? "diese Schicht"} am {shift?.shiftDate ?? "Schichttag"}</span>
                        <span className="block text-xs mt-1">Bitte die Uhrzeit aus dem Leistungsnachweis prüfen. Die erfasste Pausendauer bleibt unverändert; danach „Rechnung vor Ausgabe prüfen“ erneut anklicken.</span>
                        <input
                          type="time"
                          className="mt-2 block rounded border bg-white px-2 py-1 text-sm"
                          value={breakStartByAssignment[reviewErrorAssignmentId] ?? ""}
                          onChange={(event) => setBreakStartByAssignment((current) => ({ ...current, [reviewErrorAssignmentId]: event.target.value }))}
                        />
                      </label>
                    );
                  })()}
              </div>
            )}
            {review && pdfUrl && (
              <div className="space-y-2 text-sm">
                <p className="font-semibold">{reviewText("draftNotice")}</p>
                <p>{review.clientName} · {review.period}</p>
                <div className="max-h-40 overflow-auto border rounded p-2">
                  {review.items.map((item) => <p key={item.pos}>{item.pos}. {item.description} · {item.hours} × {item.rate} € = {item.amount}</p>)}
                </div>
                <p>{reviewText("net")}: {review.subtotal} · {reviewText("tax")}: {review.taxAmount} · {reviewText("gross")}: {review.total}</p>
                {Object.keys(breakStartByAssignment).length > 0 && <p className="text-amber-800">Pausenzeiten wurden manuell für diese Vorschau erfasst. Bitte mit den Leistungsnachweisen abgleichen.</p>}
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">{reviewText("openPdf")}</a>
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={accountingConfirmed} onChange={(e) => setAccountingConfirmed(e.target.checked)} />
                  <span>{reviewText("accountingConfirmed")}</span>
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit} disabled={selectedIds.size === 0 || submitting || reviewing || (!!requiresReview && (!review || !pdfUrl || !accountingConfirmed))}>
            {submitting ? "Wird ausgeführt..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
