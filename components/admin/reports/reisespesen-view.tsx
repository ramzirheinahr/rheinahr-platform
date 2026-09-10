"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Printer, Calculator, FileSpreadsheet, Loader2 } from "lucide-react";
import { fetchReisespesenAction } from "@/app/[locale]/admin/reports/actions";
import type { ReisespesenRow } from "@/lib/reports-data";

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

  const selectedWorker = workers.find((w) => w.id === workerId);
  const selectedMonth = MONTHS.find((m) => m.value === month);

  return (
    <div className="w-full space-y-6">
      {/* Control Card */}
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

      {/* Results Table */}
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
    </div>
  );
}
