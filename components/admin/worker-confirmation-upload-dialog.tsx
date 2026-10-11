"use client";

import { useState, useTransition, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Search,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Building,
  Calendar,
  Clock,
  X,
  FileCheck,
} from "lucide-react";
import { uploadWorkerConfirmationEvidenceAction } from "@/app/[locale]/admin/workers/[id]/schedule/actions";

export interface WorkerShiftOption {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  facilityName: string;
  scheduledHours?: number | null;
  confirmedHours?: number | null;
  status: string;
}

interface WorkerConfirmationUploadDialogProps {
  workerId: string;
  workerName: string;
  year: number;
  month: number;
  shifts: WorkerShiftOption[];
  triggerBtn?: React.ReactNode;
}

export function WorkerConfirmationUploadDialog({
  workerId,
  workerName,
  year,
  month,
  shifts,
  triggerBtn,
}: WorkerConfirmationUploadDialogProps) {
  const t = useTranslations("confirmations");
  const c = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const [facilityFilter, setFacilityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [signerName, setSignerName] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Distinct facility names for filter dropdown
  const facilities = useMemo(() => {
    const set = new Set<string>();
    shifts.forEach((s) => {
      if (s.facilityName) set.add(s.facilityName);
    });
    return Array.from(set).sort();
  }, [shifts]);

  // Filtered shifts based on facility filter & search query
  const filteredShifts = useMemo(() => {
    return shifts.filter((s) => {
      if (facilityFilter !== "all" && s.facilityName !== facilityFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesDate = s.date.toLowerCase().includes(q);
        const matchesFacility = s.facilityName.toLowerCase().includes(q);
        if (!matchesDate && !matchesFacility) return false;
      }
      return true;
    });
  }, [shifts, facilityFilter, searchQuery]);

  // Count how many selected shifts are currently hidden by filters
  const hiddenSelectedCount = useMemo(() => {
    const visibleIds = new Set(filteredShifts.map((s) => s.id));
    let count = 0;
    selectedShiftIds.forEach((id) => {
      if (!visibleIds.has(id)) count++;
    });
    return count;
  }, [filteredShifts, selectedShiftIds]);

  // Summary of selected facilities and dates
  const selectedSummary = useMemo(() => {
    const selected = shifts.filter((s) => selectedShiftIds.has(s.id));
    const facilityMap: Record<string, string[]> = {};
    selected.forEach((s) => {
      if (!facilityMap[s.facilityName]) {
        facilityMap[s.facilityName] = [];
      }
      facilityMap[s.facilityName].push(s.date);
    });
    return facilityMap;
  }, [shifts, selectedShiftIds]);

  function toggleShift(id: string) {
    setSelectedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSelectAllFiltered() {
    setSelectedShiftIds((prev) => {
      const next = new Set(prev);
      filteredShifts.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function handleDeselectAllFiltered() {
    setSelectedShiftIds((prev) => {
      const next = new Set(prev);
      filteredShifts.forEach((s) => next.delete(s.id));
      return next;
    });
  }

  function mapServerErrorMessage(err: string | null | undefined): string {
    if (!err) return t("uploadGenericError");
    const lower = err.toLowerCase();
    if (
      lower.includes("invalid_assignment_ids") ||
      lower.includes("ungültiger schichtbezeichner") ||
      lower.includes("mindestens eine schicht")
    ) {
      return t("invalidShiftIdsError");
    }
    if (
      lower.includes("worker_mismatch") ||
      lower.includes("gehören nicht zum angegebenen mitarbeiter") ||
      lower.includes("gehören nicht zu diesem mitarbeiter")
    ) {
      return t("workerMismatchError");
    }
    if (
      lower.includes("duplicate_document") ||
      lower.includes("bereits hochgeladen") ||
      lower.includes("p2002")
    ) {
      return t("duplicateDocumentError");
    }
    if (
      lower.includes("storage_upload_failed") ||
      lower.includes("speichersystem")
    ) {
      return t("storageUploadError");
    }
    if (lower.includes("oversized") || lower.includes("25 mb") || lower.includes("zu groß")) {
      return t("fileTooLargeError");
    }
    if (lower.includes("unsupported") || lower.includes("mime") || lower.includes("dateiformat")) {
      return t("unsupportedFileTypeError");
    }
    return t("uploadGenericError");
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > 25 * 1024 * 1024) {
      setErrorMessage(t("fileSizeExceeded"));
      setFile(null);
      return;
    }

    setErrorMessage(null);
    setFile(selectedFile);
  }

  function resetForm() {
    setSelectedShiftIds(new Set());
    setFacilityFilter("all");
    setSearchQuery("");
    setFile(null);
    setSignerName("");
    setNotes("");
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit() {
    if (selectedShiftIds.size === 0) {
      setErrorMessage(t("selectAtLeastOneShift"));
      return;
    }
    if (!file) {
      setErrorMessage(t("fileRequired"));
      return;
    }

    setErrorMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("workerId", workerId);
      formData.append(
        "assignmentIds",
        JSON.stringify(Array.from(selectedShiftIds))
      );
      formData.append("file", file);
      if (signerName.trim()) formData.append("signerName", signerName.trim());
      if (notes.trim()) formData.append("notes", notes.trim());

      const res = await uploadWorkerConfirmationEvidenceAction(formData);
      if (res.ok) {
        toast.success(
          t("uploadSuccess", { count: res.count || selectedShiftIds.size })
        );
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        setErrorMessage(mapServerErrorMessage(res.error));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) resetForm();
    }}>
      <DialogTrigger
        render={
          triggerBtn ? (
            (triggerBtn as React.ReactElement)
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              variant="default"
            >
              <Upload className="size-4" />
              {t("uploadWorkerTimesheet")}
            </Button>
          )
        }
      />

      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-start">
            <FileText className="size-5 text-primary" />
            {t("uploadWorkerTimesheet")}
          </DialogTitle>
          <DialogDescription className="text-start">
            {t("uploadWorkerTimesheetDesc")}
          </DialogDescription>
        </DialogHeader>

        {/* Worker & Month info */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="text-muted-foreground">{t("workerLabel")}</span>
            <span className="text-foreground font-semibold">{workerName}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>{t("periodLabel")}</span>
            <Badge variant="outline" className="font-mono text-xs">
              {String(month).padStart(2, "0")}/{year}
            </Badge>
          </div>
        </div>

        {/* Filters bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Facility Filter */}
          <div className="space-y-1 text-start">
            <Label className="text-xs text-muted-foreground">
              {t("filterFacility")}
            </Label>
            <select
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">{t("allFacilities")}</option>
              {facilities.map((fac) => (
                <option key={fac} value={fac}>
                  {fac}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div className="space-y-1 text-start">
            <Label className="text-xs text-muted-foreground">
              {c("search") || "Suche"}
            </Label>
            <div className="relative">
              <Search className="absolute start-2.5 top-2 size-3.5 text-muted-foreground" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchShifts")}
                className="ps-8 h-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute end-2 top-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Selection Actions & Count */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 pt-1 text-xs">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAllFiltered}
              className="h-7 text-xs px-2"
              disabled={filteredShifts.length === 0}
            >
              {t("selectAll")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDeselectAllFiltered}
              className="h-7 text-xs px-2"
              disabled={filteredShifts.length === 0}
            >
              {t("deselectAll")}
            </Button>
          </div>

          <Badge
            variant={selectedShiftIds.size > 0 ? "default" : "secondary"}
            className="text-xs"
          >
            {t("selectedShiftsCount", { count: selectedShiftIds.size })}
          </Badge>
        </div>

        {/* Warning if selected shifts are hidden by current filters */}
        {hiddenSelectedCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 text-start">
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <span>
              {t("hiddenSelectedWarning", { count: hiddenSelectedCount })}
            </span>
          </div>
        )}

        {/* Shifts List with Checkboxes */}
        <div className="space-y-1 max-h-56 overflow-y-auto rounded-md border p-2">
          {shifts.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("noShiftsForWorker")}
            </p>
          ) : filteredShifts.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("filterEmpty")}
            </p>
          ) : (
            filteredShifts.map((s) => {
              const isChecked = selectedShiftIds.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex items-center justify-between gap-3 rounded p-2 text-xs cursor-pointer transition-colors ${
                    isChecked
                      ? "bg-primary/10 border border-primary/20"
                      : "hover:bg-muted/50 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleShift(s.id)}
                      className="size-4 rounded border-input text-primary focus:ring-primary cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        <Calendar className="size-3 text-muted-foreground" />
                        <span>{s.date}</span>
                        <Clock className="size-3 text-muted-foreground ms-1" />
                        <span>
                          {s.startTime}–{s.endTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-muted-foreground mt-0.5">
                        <Building className="size-3 text-muted-foreground" />
                        <span>{s.facilityName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {s.confirmedHours != null ? (
                      <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                        <CheckCircle2 className="size-2.5" />
                        {s.confirmedHours} {t("hoursUnit")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        {s.scheduledHours != null ? `${s.scheduledHours} ${t("hoursUnit")}` : "—"}
                      </Badge>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>

        {/* Selected Shifts Summary */}
        {selectedShiftIds.size > 0 && (
          <div className="rounded-md border bg-muted/30 p-2.5 text-xs text-start space-y-1">
            <span className="font-semibold text-foreground">
              {t("selectedShiftsCount", { count: selectedShiftIds.size })}:
            </span>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {Object.entries(selectedSummary).map(([fac, dates]) => (
                <div
                  key={fac}
                  className="inline-flex items-center gap-1 rounded bg-background px-2 py-1 border text-[11px]"
                >
                  <Building className="size-3 text-primary" />
                  <span className="font-medium">{fac}</span>
                  <span className="text-muted-foreground">({dates.length})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* File Upload Section */}
        <div className="space-y-3 pt-2 text-start">
          <div className="space-y-1">
            <Label className="text-xs font-semibold">
              {t("signedDocLabel")} <span className="text-rose-500">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*"
                onChange={handleFileChange}
                className="hidden"
                id="timesheet-file-input"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 text-xs"
              >
                <Upload className="size-3.5" />
                {file ? t("changeFile") : t("selectFile")}
              </Button>
              {file && (
                <div className="flex items-center gap-1.5 text-xs text-foreground font-mono bg-muted px-2 py-1 rounded">
                  <FileCheck className="size-3.5 text-emerald-600" />
                  <span className="truncate max-w-[200px]">{file.name}</span>
                  <span className="text-muted-foreground">
                    ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("fileTypeHint")}
            </p>
          </div>

          {/* Optional Signer & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("signerFacilityLabel")}</Label>
              <Input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder={t("signerFacilityPlaceholder")}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {c("notes")} {t("optionalLabel")}
              </Label>
              <Input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 text-start">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <DialogFooter className="mx-0 mb-0 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {c("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || selectedShiftIds.size === 0 || !file}
            className="gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("uploading")}
              </>
            ) : (
              <>
                <Upload className="size-4" />
                {t("uploadWorkerSubmit", { count: selectedShiftIds.size })}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
