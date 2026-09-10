"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Printer, Search, Save, Loader2, Check, X } from "lucide-react";
import { fetchArbeitszeitkontoAction, saveAzkNotesAction } from "@/app/[locale]/admin/reports/actions";
import type { MonthlyHoursAccount } from "@/lib/hours-account";

const MONTHS = [
  { value: "01", label: "Januar" },
  { value: "02", label: "Februar" },
  { value: "03", label: "März" },
  { value: "04", label: "April" },
  { value: "05", label: "Mai" },
  { value: "06", label: "Juni" },
  { value: "07", label: "Juli" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "Oktober" },
  { value: "11", label: "November" },
  { value: "12", label: "Dezember" },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function ArbeitszeitkontoView({
  workers,
}: {
  workers: Array<{
    id: string;
    fullName: string;
    internalNumber: string | null;
    employmentStartDate?: Date | null;
    employedSince?: Date | null;
  }>;
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = String(now.getMonth() + 1).padStart(2, "0");

  const [selectedWorkerId, setSelectedWorkerId] = useState<string>(workers[0]?.id || "");
  const [zeiterfassungInsgesamt, setZeiterfassungInsgesamt] = useState<boolean>(true);
  const [withPrevBalance, setWithPrevBalance] = useState<boolean>(true);

  const [startYear, setStartYear] = useState<number>(2026);
  const [startMonth, setStartMonth] = useState<string>("07");
  const [endYear, setEndYear] = useState<number>(currentY);
  const [endMonth, setEndMonth] = useState<string>(currentM);

  // Multi-select for batch printing
  const [selectedWorkersBatch, setSelectedWorkersBatch] = useState<string[]>([]);
  const [batchSearchQuery, setBatchSearchQuery] = useState<string>("");

  // Table rows, initial carryover & editable notes
  const [rows, setRows] = useState<Array<MonthlyHoursAccount & { notes?: string }> | null>(null);
  const [initialCarryover, setInitialCarryover] = useState<number | null>(null);
  const [notesState, setNotesState] = useState<Record<string, string>>({});
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!selectedWorkerId) return;
    setSavedSuccess(false);
    startTransition(async () => {
      const res = await fetchArbeitszeitkontoAction({
        workerId: selectedWorkerId,
        startMonth: `${startYear}-${startMonth}`,
        endMonth: `${endYear}-${endMonth}`,
        zeiterfassungInsgesamt,
        withPrevBalance,
      });

      setRows(res.months);
      setInitialCarryover(res.initialCarryover);
      const initialNotes: Record<string, string> = {};
      for (const m of res.months) {
        initialNotes[m.month] = m.notes || "";
      }
      setNotesState(initialNotes);
    });
  };

  React.useEffect(() => {
    if (selectedWorkerId) {
      handleSearch();
    }
  }, [selectedWorkerId, zeiterfassungInsgesamt, withPrevBalance]);

  const handleSaveNotes = () => {
    if (!selectedWorkerId) return;
    startTransition(async () => {
      await saveAzkNotesAction({
        workerId: selectedWorkerId,
        notes: notesState,
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    });
  };

  const handlePrint = (workerIdToPrint: string) => {
    const params = new URLSearchParams({
      start: zeiterfassungInsgesamt ? "2026-07" : `${startYear}-${startMonth}`,
      end: `${endYear}-${endMonth}`,
      withPrevBalance: String(withPrevBalance),
    });
    window.open(`/api/workers/${workerIdToPrint}/arbeitszeitkonto?${params.toString()}`, "_blank");
  };

  const handleSelectAllWorkers = () => {
    if (selectedWorkersBatch.length === workers.length) {
      setSelectedWorkersBatch([]);
    } else {
      setSelectedWorkersBatch(workers.map((w) => w.id));
    }
  };

  const toggleWorkerBatch = (id: string) => {
    if (selectedWorkersBatch.includes(id)) {
      setSelectedWorkersBatch(selectedWorkersBatch.filter((wId) => wId !== id));
    } else {
      setSelectedWorkersBatch([...selectedWorkersBatch, id]);
    }
  };

  const selectedWorker = workers.find((w) => w.id === selectedWorkerId);

  return (
    <div className="w-full space-y-6">
      {/* Top Filter & Control Panel */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Side: Single Worker Form Controls */}
        <Card className="lg:col-span-8 border-border/80 shadow-xs">
          <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
            <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
              {t("arbeitszeitkonto.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.worker")}:</label>
              <SearchableSelect
                options={workers.map((w) => ({
                  value: w.id,
                  label: w.fullName,
                  subLabel: w.internalNumber ? w.internalNumber : undefined,
                  searchTerms: `${w.fullName} ${w.internalNumber || ""}`,
                }))}
                value={selectedWorkerId}
                onValueChange={setSelectedWorkerId}
                placeholder={t("common.worker")}
                searchPlaceholder="Mitarbeiter suchen..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={zeiterfassungInsgesamt}
                  onChange={(e) => setZeiterfassungInsgesamt(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                />
                <span className="font-medium text-foreground">
                  {t("arbeitszeitkonto.totalPeriod")}
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withPrevBalance}
                  onChange={(e) => setWithPrevBalance(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                />
                <span className="font-medium text-foreground flex items-center gap-2">
                  <span>{t("arbeitszeitkonto.withPrevBalance")}</span>
                  {initialCarryover !== null && withPrevBalance && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold tracking-tight shadow-xs ${
                        initialCarryover >= 0
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                          : "bg-rose-100 text-rose-800 border border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                      }`}
                    >
                      {initialCarryover > 0 ? `+${initialCarryover.toFixed(2)}` : initialCarryover.toFixed(2)} Std.
                    </span>
                  )}
                </span>
              </label>
            </div>

            {!zeiterfassungInsgesamt && (
              <div className="grid gap-3 sm:grid-cols-2 p-3 bg-muted/20 rounded-lg border border-border/60 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-muted-foreground">Von:</span>
                  <Input
                    type="number"
                    value={startYear}
                    onChange={(e) => setStartYear(parseInt(e.target.value, 10) || startYear)}
                    className="h-8 w-20"
                  />
                  <Select value={startMonth} onValueChange={(v) => { if (v !== null) setStartMonth(v); }}>
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue>
                        {MONTHS.find((m) => m.value === startMonth)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-12 text-muted-foreground">Bis:</span>
                  <Input
                    type="number"
                    value={endYear}
                    onChange={(e) => setEndYear(parseInt(e.target.value, 10) || endYear)}
                    className="h-8 w-20"
                  />
                  <Select value={endMonth} onValueChange={(v) => { if (v !== null) setEndMonth(v); }}>
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue>
                        {MONTHS.find((m) => m.value === endMonth)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/60">
              {savedSuccess ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  {t("common.savedSuccess")}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t("internalNotice")}
                </span>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSearch}
                  disabled={isPending || !selectedWorkerId}
                  className="gap-1.5 h-8 text-xs rounded-lg"
                >
                  {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  {t("common.search")}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={isPending || !rows}
                  className="gap-1.5 h-8 text-xs rounded-lg"
                >
                  <Save className="w-3.5 h-3.5" />
                  {t("common.save")}
                </Button>

                <Button
                  size="sm"
                  onClick={() => handlePrint(selectedWorkerId)}
                  disabled={!selectedWorkerId}
                  className="gap-1.5 h-8 text-xs rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {t("common.print")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Side: Batch Workers Selection (Image 10 right side) */}
        <Card className="lg:col-span-4 border-border shadow-sm flex flex-col">
          <CardHeader className="bg-muted/40 pb-2.5 pt-3 border-b flex flex-row items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              {t("common.worker")} Liste
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAllWorkers}
              className="h-7 text-[11px] px-2"
            >
              {t("arbeitszeitkonto.selectAll")}
            </Button>
          </CardHeader>
          <CardContent className="p-2 flex-1 flex flex-col justify-between space-y-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Mitarbeiter filtern..."
                value={batchSearchQuery}
                onChange={(e) => setBatchSearchQuery(e.target.value)}
                className="h-7 text-xs pl-8 pr-7"
              />
              {batchSearchQuery && (
                <button
                  type="button"
                  onClick={() => setBatchSearchQuery("")}
                  className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>

            <div className="h-40 overflow-y-auto space-y-1 pr-1">
              {workers
                .filter((w) => {
                  const tokens = normalize(batchSearchQuery).split(/\s+/).filter(Boolean);
                  if (tokens.length === 0) return true;
                  const hay = normalize(`${w.fullName} ${w.internalNumber || ""} ${w.id}`);
                  return tokens.every((token) => hay.includes(token));
                })
                .map((w) => (
                  <label
                    key={w.id}
                    className="flex items-center gap-2 p-1 rounded hover:bg-muted/50 cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={selectedWorkersBatch.includes(w.id)}
                      onChange={() => toggleWorkerBatch(w.id)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary/40"
                    />
                    <span className="truncate">
                      {w.fullName} {w.internalNumber ? `- ${w.internalNumber}` : ""}
                    </span>
                  </label>
                ))}
            </div>

            <div className="pt-2 border-t mt-2 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={selectedWorkersBatch.length === 0}
                onClick={() => {
                  for (const id of selectedWorkersBatch) {
                    handlePrint(id);
                  }
                }}
                className="gap-1.5 h-7 text-xs"
              >
                <Printer className="w-3 h-3" />
                Drucken ({selectedWorkersBatch.length})
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AZK Table (Image 10) */}
      {rows && (
        <Card className="w-full border-border/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="bg-muted/60 border-b text-muted-foreground font-semibold">
                  <th className="p-2 text-center w-8">#</th>
                  <th className="p-2">{t("common.month")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.soll")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.ist")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.kAusgleich")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.vacation")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.sick")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.other")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.monthBalance")}</th>
                  <th className="p-2 text-right">{t("arbeitszeitkonto.cumBalance")}</th>
                  <th className="p-2 min-w-[260px]">{t("arbeitszeitkonto.notesHeader")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  <>
                    {withPrevBalance && initialCarryover !== null && (
                      <tr className="bg-slate-50/80 dark:bg-zinc-800/50 font-semibold border-b border-border text-foreground">
                        <td className="p-2 text-center text-muted-foreground">-</td>
                        <td className="p-2 font-bold whitespace-nowrap text-primary">
                          {t("arbeitszeitkonto.carryover")}
                        </td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td className="p-2 text-right text-muted-foreground">-</td>
                        <td
                          className={`p-2 text-right font-bold ${
                            initialCarryover >= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700 dark:text-rose-400"
                          }`}
                        >
                          {initialCarryover.toFixed(2)}
                        </td>
                        <td className="p-2 text-muted-foreground italic text-[11px]">
                          {t("arbeitszeitkonto.carryoverHint")}
                        </td>
                      </tr>
                    )}
                    {rows.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
                      <td className="p-2 font-semibold whitespace-nowrap bg-muted/10">
                        {r.month}
                      </td>
                      <td className="p-2 text-right">{r.requiredHours.toFixed(2)}</td>
                      <td className="p-2 text-right font-medium">{r.workedHours.toFixed(2)}</td>
                      <td className="p-2 text-right">
                        {r.kAusgleichHours > 0 ? r.kAusgleichHours.toFixed(2) : ""}
                      </td>
                      <td className="p-2 text-right">
                        {r.vacationHours > 0 ? r.vacationHours.toFixed(2) : ""}
                      </td>
                      <td className="p-2 text-right">
                        {r.sickHours !== 0 ? r.sickHours.toFixed(2) : ""}
                      </td>
                      <td className="p-2 text-right">
                        {r.sonstigeHours > 0 ? r.sonstigeHours.toFixed(2) : ""}
                      </td>
                      <td
                        className={`p-2 text-right font-semibold ${
                          r.monthBalance >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {r.monthBalance.toFixed(2)}
                      </td>
                      <td
                        className={`p-2 text-right font-bold ${
                          r.cumulativeBalance >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {r.cumulativeBalance.toFixed(2)}
                      </td>
                      <td className="p-1.5">
                        <Input
                          type="text"
                          value={notesState[r.month] ?? ""}
                          onChange={(e) =>
                            setNotesState({
                              ...notesState,
                              [r.month]: e.target.value,
                            })
                          }
                          placeholder="Notiz hinzufügen..."
                          className="h-7 text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
