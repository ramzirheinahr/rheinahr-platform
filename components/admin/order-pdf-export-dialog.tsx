"use client";

import { useState, useMemo } from "react";
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
import { Download, Search, CheckSquare, Square } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { qualLabel } from "@/lib/invoicing";
import { cn } from "@/lib/utils";

export type SelectableOrderShift = {
  id: string;
  shiftDate: string; // ISO date string "YYYY-MM-DD"
  startTime: string; // "06:00"
  endTime: string;   // "14:30"
  requiredQualification?: string | null;
  ward?: string | null;
  workerName?: string | null;
  status?: string | null;
};

interface OrderPdfExportDialogProps {
  requestGroupId: string;
  shifts: SelectableOrderShift[];
  facilityName?: string;
  className?: string;
}

export function OrderPdfExportDialog({
  requestGroupId,
  shifts,
  facilityName,
  className,
}: OrderPdfExportDialogProps) {
  const t = useTranslations("orderPdfExport");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(shifts.map((s) => s.id))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [workerFilter, setWorkerFilter] = useState<string>("all");

  // Format date with UTC to prevent any DST shifts: e.g. "So 04.10.2026"
  const formatDateWithWeekday = (isoDateStr: string) => {
    try {
      const d = new Date(`${isoDateStr}T00:00:00Z`);
      const intlLocale = locale === "ar" ? "ar-EG" : locale === "en" ? "en-GB" : "de-DE";
      const weekday = new Intl.DateTimeFormat(intlLocale, {
        weekday: "short",
        timeZone: "UTC",
      }).format(d);
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const year = d.getUTCFullYear();
      return `${weekday} ${day}.${month}.${year}`;
    } catch {
      return isoDateStr;
    }
  };

  // Distinct worker names
  const workers = useMemo(() => {
    const set = new Set<string>();
    for (const s of shifts) {
      if (s.workerName) set.add(s.workerName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [shifts]);

  // Filtered shifts based on search query and worker filter
  const filteredShifts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return shifts.filter((s) => {
      if (workerFilter !== "all") {
        if (workerFilter === "__unassigned__") {
          if (s.workerName) return false;
        } else if (s.workerName !== workerFilter) {
          return false;
        }
      }

      if (!q) return true;

      const dateStr = formatDateWithWeekday(s.shiftDate).toLowerCase();
      const rawDate = s.shiftDate.toLowerCase();
      const times = `${s.startTime} ${s.endTime}`.toLowerCase();
      const worker = (s.workerName || "").toLowerCase();
      const ward = (s.ward || "").toLowerCase();
      const qual = (s.requiredQualification ? (qualLabel[s.requiredQualification as keyof typeof qualLabel] || s.requiredQualification) : "").toLowerCase();

      return (
        dateStr.includes(q) ||
        rawDate.includes(q) ||
        times.includes(q) ||
        worker.includes(q) ||
        ward.includes(q) ||
        qual.includes(q)
      );
    });
  }, [shifts, searchQuery, workerFilter, locale]);

  const allFilteredSelected =
    filteredShifts.length > 0 &&
    filteredShifts.every((s) => selectedIds.has(s.id));

  const toggleShift = (id: string) => {
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

  const handleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const s of filteredShifts) {
          next.delete(s.id);
        }
      } else {
        for (const s of filteredShifts) {
          next.add(s.id);
        }
      }
      return next;
    });
  };

  const handleExportSelected = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    // If all are selected, export without query param for cleaner URL
    const url = ids.length === shifts.length
      ? `/api/exports/order-request/${encodeURIComponent(requestGroupId)}?format=pdf`
      : `/api/exports/order-request/${encodeURIComponent(requestGroupId)}?format=pdf&orderIds=${encodeURIComponent(ids.join(","))}`;
    window.open(url, "_blank");
    setOpen(false);
  };

  const handleExportAll = () => {
    const url = `/api/exports/order-request/${encodeURIComponent(requestGroupId)}?format=pdf`;
    window.open(url, "_blank");
    setOpen(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      // Re-initialize with all shifts selected when opening
      setSelectedIds(new Set(shifts.map((s) => s.id)));
      setSearchQuery("");
      setWorkerFilter("all");
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className={cn("gap-2", className)}
        onClick={() => handleOpenChange(true)}
      >
        <Download className="size-4" />
        {t("buttonLabel")}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-[620px] p-0 gap-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <Download className="size-5 text-primary" />
              {t("dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {facilityName ? `${facilityName} · ` : ""}
              {t("dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          {/* Filter and Selection Toolbar */}
          <div className="p-4 border-b bg-muted/20 space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>

              {workers.length > 0 && (
                <select
                  aria-label={t("allWorkers")}
                  className="h-9 text-sm border rounded-md px-2.5 bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
                  value={workerFilter}
                  onChange={(e) => setWorkerFilter(e.target.value)}
                >
                  <option value="all">{t("allWorkers")}</option>
                  <option value="__unassigned__">{t("unassigned")}</option>
                  {workers.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">
                {t("selectedCount", {
                  selected: selectedIds.size,
                  total: shifts.length,
                })}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs font-medium gap-1"
                onClick={handleSelectAllFiltered}
              >
                {allFilteredSelected ? (
                  <>
                    <Square className="size-3.5" />
                    {t("deselectAll")}
                  </>
                ) : (
                  <>
                    <CheckSquare className="size-3.5" />
                    {t("selectAll")}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Scrollable Shift List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[240px] max-h-[46vh]">
            {filteredShifts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("noShiftsMatch")}
              </div>
            ) : (
              filteredShifts.map((shift) => {
                const isSelected = selectedIds.has(shift.id);
                const qual = shift.requiredQualification
                  ? (qualLabel[shift.requiredQualification as keyof typeof qualLabel] || shift.requiredQualification)
                  : null;

                return (
                  <div
                    key={shift.id}
                    onClick={() => toggleShift(shift.id)}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border text-sm transition-colors cursor-pointer select-none",
                      isSelected
                        ? "bg-primary/5 border-primary/30"
                        : "bg-background hover:bg-muted/40 border-border"
                    )}
                  >
                    <input
                      type="checkbox"
                      id={`shift-${shift.id}`}
                      className="size-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                      checked={isSelected}
                      onChange={() => toggleShift(shift.id)}
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">
                          {formatDateWithWeekday(shift.shiftDate)}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                          {shift.startTime} – {shift.endTime}
                        </span>
                        {qual && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-medium">
                            {qual}
                          </span>
                        )}
                        {shift.ward && (
                          <span className="text-xs text-muted-foreground">
                            • {shift.ward}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span>
                          {shift.workerName ? (
                            <span className="text-foreground/80 font-medium">
                              {shift.workerName}
                            </span>
                          ) : (
                            <span className="italic text-muted-foreground">
                              {t("unassigned")}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <DialogFooter className="p-4 border-t bg-muted/20 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleExportAll}
              >
                {t("exportAll", { total: shifts.length })}
              </Button>

              <Button
                type="button"
                onClick={handleExportSelected}
                disabled={selectedIds.size === 0}
                className="gap-2"
              >
                <Download className="size-4" />
                {t("exportSelected", { count: selectedIds.size })}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
