"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Printer, Calculator, FileSpreadsheet, Loader2, Search, X, Users } from "lucide-react";
import { fetchReisespesenAction, fetchMonthlySpesenOverviewAction } from "@/app/[locale]/admin/reports/actions";
import type { ReisespesenRow, MonthlySpesenOverviewData } from "@/lib/reports-data";

const MONTHS = [
  { value: 1, label: "Januar" },
  { value: 2, label: "Februar" },
  { value: 3, label: "März" },
  { value: 4, label: "April" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Dezember" },
];

export function ReisespesenView({
  workers,
}: {
  workers: Array<{ id: string; fullName: string; internalNumber: string | null }>;
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [workerId, setWorkerId] = useState<string>(workers[0]?.id || "");

  const [data, setData] = useState<{
    rows: ReisespesenRow[];
    totalDistance: number;
    totalCost: number;
    worker: { fullName: string; internalNumber: string | null };
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Monthly Overview State (Fahrt & Verpflegung aller Mitarbeiter)
  const [overviewYear, setOverviewYear] = useState<number>(now.getFullYear());
  const [overviewMonth, setOverviewMonth] = useState<number>(now.getMonth() + 1);
  const [onlyWithAmounts, setOnlyWithAmounts] = useState<boolean>(true);
  const [overviewSearchQuery, setOverviewSearchQuery] = useState<string>("");
  const [overviewData, setOverviewData] = useState<MonthlySpesenOverviewData | null>(null);
  const [isOverviewPending, startOverviewTransition] = useTransition();

  const handleCalculate = () => {
    if (!workerId) return;
    startTransition(async () => {
      const res = await fetchReisespesenAction({ year, month, workerId });
      setData(res);
    });
  };

  const handlePrint = () => {
    if (!workerId) return;
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      workerId,
    });
    window.open(`/api/reports/reisespesen/pdf?${params.toString()}`, "_blank");
  };

  const handleExcelExport = () => {
    if (!workerId) return;
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      workerId,
    });
    window.open(`/api/reports/reisespesen/excel?${params.toString()}`, "_blank");
  };

  const handleCalculateOverview = () => {
    startOverviewTransition(async () => {
      const res = await fetchMonthlySpesenOverviewAction({
        year: overviewYear,
        month: overviewMonth,
        onlyWithAmounts,
      });
      setOverviewData(res);
    });
  };

  const handleExcelExportOverview = () => {
    const params = new URLSearchParams({
      year: String(overviewYear),
      month: String(overviewMonth),
      onlyWithAmounts: String(onlyWithAmounts),
    });
    window.open(`/api/reports/reisespesen/overview-excel?${params.toString()}`, "_blank");
  };

  const filteredOverviewRows = React.useMemo(() => {
    if (!overviewData) return [];
    if (!overviewSearchQuery.trim()) return overviewData.rows;
    const query = overviewSearchQuery.toLowerCase().trim();
    return overviewData.rows.filter(
      (r) =>
        r.fullName.toLowerCase().includes(query) ||
        (r.internalNumber && r.internalNumber.toLowerCase().includes(query))
    );
  }, [overviewData, overviewSearchQuery]);

  const filteredTotals = React.useMemo(() => {
    return filteredOverviewRows.reduce(
      (acc, r) => ({
        totalFahrtCost: Math.round((acc.totalFahrtCost + r.totalFahrtCost) * 100) / 100,
        totalMealAllowance: Math.round((acc.totalMealAllowance + r.totalMealAllowance) * 100) / 100,
        totalAmount: Math.round((acc.totalAmount + r.totalAmount) * 100) / 100,
      }),
      {
        totalFahrtCost: 0,
        totalMealAllowance: 0,
        totalAmount: 0,
      }
    );
  }, [filteredOverviewRows]);

  const selectedMonth = MONTHS.find((m) => m.value === month);
  const selectedOverviewMonth = MONTHS.find((m) => m.value === overviewMonth);

  return (
    <div className="w-full space-y-6">
      {/* 1. Control Card: Single Worker Reisespesen */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("reisespesen.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.year")}:</label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.month")}:</label>
              <Select value={String(month)} onValueChange={(v) => { if (v) setMonth(parseInt(v, 10)); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.month")}>
                    {selectedMonth?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.worker")}:</label>
              <SearchableSelect
                options={workers.map((w) => ({
                  value: w.id,
                  label: w.fullName,
                  subLabel: w.internalNumber ? w.internalNumber : undefined,
                  searchTerms: `${w.fullName} ${w.internalNumber || ""}`,
                }))}
                value={workerId}
                onValueChange={setWorkerId}
                placeholder={t("common.worker")}
                searchPlaceholder="Mitarbeiter suchen..."
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 mt-5 pt-4 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCalculate}
              disabled={isPending || !workerId}
              className="gap-1.5 h-9 rounded-lg"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              {t("common.calculate")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExcelExport}
              disabled={!workerId}
              className="gap-1.5 h-9 rounded-lg border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              <FileSpreadsheet className="w-4 h-4" />
              {t("common.excelExport")}
            </Button>

            <Button
              size="sm"
              onClick={handlePrint}
              disabled={!workerId}
              className="gap-1.5 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
            >
              <Printer className="w-4 h-4" />
              {t("common.print")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Single Worker Results Table */}
      {data && (
        <Card className="w-full border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="bg-muted/30 pb-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Reisespesen: {data.worker.fullName} {data.worker.internalNumber ? `(${data.worker.internalNumber})` : ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Jahr: {year} · Monat: {month} · {data.rows.length} Fahrten berechnet
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleExcelExport}
                className="gap-1.5 h-8 text-xs rounded-lg border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Excel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handlePrint}
                className="gap-1.5 h-8 text-xs rounded-lg"
              >
                <Printer className="w-3.5 h-3.5" />
                {t("common.print")}
              </Button>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="bg-muted/80 border-b border-border/80 text-foreground font-bold">
                  <th className="p-2.5 text-center w-10 font-bold text-foreground">#</th>
                  <th className="p-2.5 font-bold text-foreground">{t("stundennachweis.shiftDate")}</th>
                  <th className="p-2.5 text-center font-bold text-foreground">{t("reisespesen.from")}</th>
                  <th className="p-2.5 text-center font-bold text-foreground">{t("reisespesen.to")}</th>
                  <th className="p-2.5 font-bold text-foreground">{t("reisespesen.customer")}</th>
                  <th className="p-2.5 font-bold text-foreground">{t("reisespesen.addressFrom")}</th>
                  <th className="p-2.5 font-bold text-foreground">{t("reisespesen.addressTo")}</th>
                  <th className="p-2.5 text-right font-bold text-foreground">{t("reisespesen.distance")}</th>
                  <th className="p-2.5 text-right font-bold text-foreground">{t("reisespesen.totalCost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2 text-center text-muted-foreground">{r.index}</td>
                      <td className="p-2 font-medium whitespace-nowrap">{r.date}</td>
                      <td className="p-2 text-center">{r.fromTime}</td>
                      <td className="p-2 text-center">{r.toTime}</td>
                      <td className="p-2 font-medium">{r.customerName}</td>
                      <td className="p-2 text-muted-foreground truncate max-w-[140px]">{r.addressFrom}</td>
                      <td className="p-2 text-muted-foreground truncate max-w-[140px]">{r.addressTo}</td>
                      <td className="p-2 text-right font-medium">
                        {r.distanceKm.toFixed(2).replace(".", ",")}
                      </td>
                      <td className="p-2 text-right font-bold text-foreground">
                        {r.totalCost.toFixed(2).replace(".", ",")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/80 font-bold border-t border-border">
                    <td colSpan={7} className="p-2.5 text-right font-semibold">
                      Gesamt:
                    </td>
                    <td className="p-2.5 text-right text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20">
                      {data.totalDistance.toFixed(2).replace(".", ",")} km
                    </td>
                    <td className="p-2.5 text-right text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20">
                      {data.totalCost.toFixed(2).replace(".", ",")} €
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* 2. Monthly Overview: All Workers (Fahrt & Verpflegung) with Excel Export */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-sm sm:text-base font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              {t("reisespesen.monthlyOverviewTitle")}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("reisespesen.monthlyOverviewSubtitle")}
            </p>
          </div>
          {overviewData && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExcelExportOverview}
              className="gap-1.5 h-8 text-xs rounded-lg border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              {t("common.excelExport")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.year")}:</label>
              <Input
                type="number"
                value={overviewYear}
                onChange={(e) => setOverviewYear(parseInt(e.target.value, 10) || overviewYear)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.month")}:</label>
              <Select
                value={String(overviewMonth)}
                onValueChange={(v) => { if (v) setOverviewMonth(parseInt(v, 10)); }}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.month")}>
                    {selectedOverviewMonth?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                <input
                  type="checkbox"
                  checked={onlyWithAmounts}
                  onChange={(e) => setOnlyWithAmounts(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary/40"
                />
                <span className="text-muted-foreground">{t("reisespesen.onlyWithAmounts")}</span>
              </label>
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCalculateOverview}
                disabled={isOverviewPending}
                className="gap-1.5 h-9 rounded-lg"
              >
                {isOverviewPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
                {t("common.calculate")}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleExcelExportOverview}
                disabled={isOverviewPending}
                className="gap-1.5 h-9 rounded-lg border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {t("common.excelExport")}
              </Button>
            </div>
          </div>

          {/* Overview Results Table */}
          {overviewData && (
            <div className="space-y-3 pt-3 border-t border-border/60">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Search className="size-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder={t("reisespesen.filterPlaceholder")}
                    value={overviewSearchQuery}
                    onChange={(e) => setOverviewSearchQuery(e.target.value)}
                    className="h-8 text-xs pl-8 pr-7"
                  />
                  {overviewSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setOverviewSearchQuery("")}
                      className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span>
                    {filteredOverviewRows.length} {t("reisespesen.workerName")}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/70">
                <table className="w-full text-xs text-start border-collapse">
                  <thead>
                    <tr className="bg-muted/80 border-b border-border/80 text-foreground font-bold">
                      <th className="p-2.5 font-bold text-foreground text-start w-36">
                        {t("reisespesen.personalNumber")}
                      </th>
                      <th className="p-2.5 font-bold text-foreground text-start">
                        {t("reisespesen.workerName")}
                      </th>
                      <th className="p-2.5 font-bold text-foreground text-right w-36">
                        {t("reisespesen.fahrtTotal")}
                      </th>
                      <th className="p-2.5 font-bold text-foreground text-right w-40">
                        {t("reisespesen.verpflegungTotal")}
                      </th>
                      <th className="p-2.5 font-bold text-foreground text-right w-40">
                        {t("reisespesen.totalSpesen")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredOverviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">
                          {t("common.noResults")}
                        </td>
                      </tr>
                    ) : (
                      filteredOverviewRows.map((r) => (
                        <tr
                          key={r.workerId}
                          onClick={() => {
                            setWorkerId(r.workerId);
                            setYear(overviewYear);
                            setMonth(overviewMonth);
                          }}
                          className="hover:bg-muted/40 transition-colors cursor-pointer"
                          title="Klicken zum Laden der Einzelfahrten oben"
                        >
                          <td className="p-2 font-mono font-medium text-muted-foreground whitespace-nowrap">
                            {r.internalNumber || "-"}
                          </td>
                          <td className="p-2 font-medium text-foreground">
                            {r.fullName}
                          </td>
                          <td className="p-2 text-right font-medium text-blue-700 dark:text-blue-400">
                            {r.totalFahrtCost.toFixed(2).replace(".", ",")} €
                          </td>
                          <td className="p-2 text-right font-medium text-amber-700 dark:text-amber-400">
                            {r.totalMealAllowance.toFixed(2).replace(".", ",")} €
                          </td>
                          <td className="p-2 text-right font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10">
                            {r.totalAmount.toFixed(2).replace(".", ",")} €
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredOverviewRows.length > 0 && (
                    <tfoot>
                      <tr className="bg-muted/80 font-bold border-t border-border">
                        <td colSpan={2} className="p-2.5 text-right font-semibold">
                          {t("reisespesen.totalSum")}:
                        </td>
                        <td className="p-2.5 text-right text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20">
                          {filteredTotals.totalFahrtCost.toFixed(2).replace(".", ",")} €
                        </td>
                        <td className="p-2.5 text-right text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/20">
                          {filteredTotals.totalMealAllowance.toFixed(2).replace(".", ",")} €
                        </td>
                        <td className="p-2.5 text-right text-emerald-700 dark:text-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20">
                          {filteredTotals.totalAmount.toFixed(2).replace(".", ",")} €
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
