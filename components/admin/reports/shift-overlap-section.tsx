"use client";

import React, { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  Search,
  Users,
  Building2,
  Calendar,
  Layers,
} from "lucide-react";
import { checkShiftOverlapsAction } from "@/app/[locale]/admin/reports/actions";
import { buildShiftOrderLink, type ShiftOverlapReportResult } from "@/lib/shift-overlap-engine";

export function ShiftOverlapSection() {
  const locale = useLocale();
  const t = useTranslations("reports.shiftOverlap");
  const tc = useTranslations("reports.common");
  const eos = useTranslations("enums.orderStatus");
  const now = new Date();

  // Localized month options using the current locale
  const months = React.useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const d = new Date(Date.UTC(2026, i, 1));
      const label = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long" }).format(d);
      return { value: m, label };
    });
  }, [locale]);

  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [report, setReport] = useState<ShiftOverlapReportResult | null>(null);
  const [workerFilter, setWorkerFilter] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleCheck = () => {
    startTransition(async () => {
      const res = await checkShiftOverlapsAction({ year, month });
      setReport(res);
    });
  };

  // Helper to translate status safely
  const formatStatus = (rawStatus: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return eos(rawStatus as any) || rawStatus;
    } catch {
      return rawStatus;
    }
  };

  // Canonical order link: use shared helper that targets group route or standalone order route
  const buildOrderLink = buildShiftOrderLink;

  // Optional filtering after report is loaded (does not mutate raw report or hide by default)
  const filteredWorkerGroups = React.useMemo(() => {
    if (!report) return [];
    return report.workerGroups
      .map((g) => {
        const matchesWorker =
          !workerFilter.trim() ||
          g.workerName.toLowerCase().includes(workerFilter.toLowerCase().trim()) ||
          (g.workerInternalNumber &&
            g.workerInternalNumber.toLowerCase().includes(workerFilter.toLowerCase().trim()));

        if (!matchesWorker) return null;

        if (!clientFilter.trim()) {
          return g;
        }

        const cf = clientFilter.toLowerCase().trim();
        const matchingPairs = g.pairs.filter(
          (p) =>
            p.shiftA.facilityName.toLowerCase().includes(cf) ||
            p.shiftB.facilityName.toLowerCase().includes(cf)
        );

        if (matchingPairs.length === 0) return null;

        return {
          ...g,
          pairs: matchingPairs,
          totalOverlapMinutes: matchingPairs.reduce((s, p) => s + p.overlapMinutes, 0),
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [report, workerFilter, clientFilter]);

  return (
    <Card className="w-full border-border/80 shadow-xs overflow-hidden">
      <CardHeader className="bg-muted/30 pb-4 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base sm:text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-500" />
              {t("title")}
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {/* Selection Toolbar: Year, Month, Check Button */}
        <div className="flex flex-wrap items-end gap-3 p-4 bg-muted/20 border border-border/60 rounded-xl">
          <div className="space-y-1.5 min-w-[120px]">
            <label className="text-xs font-medium text-muted-foreground">{tc("year")}:</label>
            <Input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
              className="h-9 text-xs sm:text-sm bg-background"
            />
          </div>

          <div className="space-y-1.5 min-w-[160px]">
            <label className="text-xs font-medium text-muted-foreground">{tc("month")}:</label>
            <Select value={String(month)} onValueChange={(v) => { if (v !== null) setMonth(parseInt(v, 10)); }}>
              <SelectTrigger className="h-9 text-xs sm:text-sm bg-background">
                <SelectValue placeholder={tc("month")} />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={handleCheck}
            disabled={isPending}
            className="h-9 px-4 gap-2 text-xs sm:text-sm font-semibold bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white shadow-sm"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t("checking")}
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                {t("checkButton")}
              </>
            )}
          </Button>
        </div>

        {/* DST & Data Quality Warnings Section */}
        {report && report.uncertainWarnings && report.uncertainWarnings.length > 0 && (
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t("dataWarningsTitle")}
                </h4>
                <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                  {t("dataWarningsDesc")}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-amber-500/20 bg-background/80">
              <table className="w-full text-xs text-start border-collapse">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground font-semibold">
                    <th className="p-2.5 text-start">{t("worker")}</th>
                    <th className="p-2.5 text-start">{t("date")}</th>
                    <th className="p-2.5 text-start">{t("shift")}</th>
                    <th className="p-2.5 text-start">{t("facility")}</th>
                    <th className="p-2.5 text-start">{t("reason")}</th>
                    <th className="p-2.5 text-end">{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {report.uncertainWarnings.map((w) => {
                    const link = buildOrderLink({
                      requestGroupId: w.requestGroupId,
                      orderId: w.orderId,
                      shiftDate: w.shiftDate,
                    });
                    const reasonLabel =
                      w.reason === "INVALID_TIME_FORMAT"
                        ? t("reasonInvalidFormat")
                        : w.reason === "DST_GAP"
                        ? t("reasonDstGap")
                        : t("reasonDstAmbiguous");
                    const reasonDesc =
                      w.reason === "INVALID_TIME_FORMAT"
                        ? t("reasonInvalidFormatDesc")
                        : w.reason === "DST_GAP"
                        ? t("reasonDstGapDesc")
                        : t("reasonDstAmbiguousDesc");

                    return (
                      <tr key={w.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-medium whitespace-nowrap">
                          {w.workerName}
                          {w.workerInternalNumber && (
                            <span className="ms-1.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {w.workerInternalNumber}
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">{w.shiftDate}</td>
                        <td className="p-2.5 font-mono whitespace-nowrap">
                          {w.startTime} – {w.endTime}
                        </td>
                        <td className="p-2.5 min-w-[140px]">{w.facilityName}</td>
                        <td className="p-2.5 text-amber-700 dark:text-amber-300">
                          <span className="font-semibold">{reasonLabel}</span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5">
                            {reasonDesc}
                          </span>
                        </td>
                        <td className="p-2.5 text-end whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            render={
                              <Link href={link} target="_blank">
                                <ExternalLink className="w-3.5 h-3.5 me-1 text-muted-foreground" />
                                {t("viewShift")}
                              </Link>
                            }
                            className="h-7 px-2 text-[11px]"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Report Content */}
        {report && (
          <div className="space-y-6">
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-border/80 bg-background/50 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("affectedWorkers")}</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground mt-1">
                    {report.affectedWorkersCount}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border/80 bg-background/50 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("overlapPairs")}</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground mt-1">
                    {report.totalOverlapPairsCount}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
                  <Layers className="w-5 h-5" />
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border/80 bg-background/50 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t("totalOverlapMinutes")}</p>
                  <p className="text-xl sm:text-2xl font-bold text-foreground mt-1">
                    {report.workerGroups.reduce((s, g) => s + g.totalOverlapMinutes, 0)} {t("minutes")}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
              </div>
            </div>

            {/* Optional in-page filters */}
            {report.totalOverlapPairsCount > 0 && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder={t("filterWorkerPlaceholder")}
                    value={workerFilter}
                    onChange={(e) => setWorkerFilter(e.target.value)}
                    className="h-9 ps-9 text-xs sm:text-sm bg-background"
                  />
                </div>
                <div className="relative flex-1">
                  <Building2 className="absolute start-3 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder={t("filterClientPlaceholder")}
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                    className="h-9 ps-9 text-xs sm:text-sm bg-background"
                  />
                </div>
              </div>
            )}

            {/* Empty state */}
            {report.totalOverlapPairsCount === 0 ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-border bg-muted/20 space-y-2">
                <Clock className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
                <h3 className="text-sm font-semibold text-foreground">{t("noResults")}</h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  {t("noResultsDesc")}
                </p>
              </div>
            ) : filteredWorkerGroups.length === 0 ? (
              <div className="p-6 text-center rounded-xl border border-dashed border-border bg-muted/20">
                <p className="text-xs text-muted-foreground">{tc("noResults")}</p>
              </div>
            ) : (
              /* Grouped List by workerId */
              <div className="space-y-4">
                {filteredWorkerGroups.map((group) => (
                  <div
                    key={group.workerId}
                    className="border border-border/80 rounded-xl bg-card overflow-hidden shadow-xs"
                  >
                    {/* Worker Header */}
                    <div className="p-3.5 sm:p-4 bg-muted/40 border-b border-border/60 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs">
                          {group.workerName.charAt(0)}
                        </div>
                        <div>
                          <span className="font-semibold text-sm text-foreground">
                            {group.workerName}
                          </span>
                          {group.workerInternalNumber && (
                            <span className="ms-2 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md border">
                              {group.workerInternalNumber}
                            </span>
                          )}
                          <span className="ms-2 text-[11px] text-muted-foreground">
                            (ID: <span className="font-mono">{group.workerId}</span>)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20">
                          {group.pairs.length} {t("overlapPairs")}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-700 dark:text-red-400 font-semibold border border-red-500/20">
                          {group.totalOverlapMinutes} {t("minutes")}
                        </span>
                      </div>
                    </div>

                    {/* Overlapping Shift Pairs Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-start border-collapse">
                        <thead>
                          <tr className="border-b bg-muted/20 text-muted-foreground">
                            <th className="p-3 font-semibold text-start">{t("time")}</th>
                            <th className="p-3 font-semibold text-start">{t("shiftA")}</th>
                            <th className="p-3 font-semibold text-start">{t("shiftB")}</th>
                            <th className="p-3 font-semibold text-center">{t("totalOverlapMinutes")}</th>
                            <th className="p-3 font-semibold text-end">{tc("actions")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {group.pairs.map((pair) => {
                            const orderLinkA = buildOrderLink(pair.shiftA);
                            const orderLinkB = buildOrderLink(pair.shiftB);

                            return (
                              <tr key={pair.id} className="hover:bg-muted/30 transition-colors">
                                {/* Overlap Date */}
                                <td className="p-3 align-top whitespace-nowrap">
                                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                                    {pair.shiftA.shiftDate}
                                  </div>
                                </td>

                                {/* Shift A Info */}
                                <td className="p-3 align-top min-w-[200px]">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1 font-semibold text-foreground">
                                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      {pair.shiftA.facilityName}
                                    </div>
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                                        {pair.shiftA.startTime} – {pair.shiftA.endTime}
                                      </span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-background font-medium">
                                        {formatStatus(pair.shiftA.status)}
                                      </span>
                                    </div>
                                    <Link
                                      href={orderLinkA}
                                      target="_blank"
                                      className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] pt-0.5"
                                    >
                                      {t("viewShift")} 1
                                      <ExternalLink className="w-3 h-3" />
                                    </Link>
                                  </div>
                                </td>

                                {/* Shift B Info */}
                                <td className="p-3 align-top min-w-[200px]">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1 font-semibold text-foreground">
                                      <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                                      {pair.shiftB.facilityName}
                                    </div>
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                      <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                                        {pair.shiftB.startTime} – {pair.shiftB.endTime}
                                      </span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-background font-medium">
                                        {formatStatus(pair.shiftB.status)}
                                      </span>
                                    </div>
                                    <Link
                                      href={orderLinkB}
                                      target="_blank"
                                      className="inline-flex items-center gap-1 text-primary hover:underline text-[11px] pt-0.5"
                                    >
                                      {t("viewShift")} 2
                                      <ExternalLink className="w-3 h-3" />
                                    </Link>
                                  </div>
                                </td>

                                {/* Overlap Duration */}
                                <td className="p-3 align-top text-center whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                                    <Clock className="w-3.5 h-3.5" />
                                    {pair.overlapMinutes} {t("minutes")}
                                  </span>
                                </td>

                                {/* Quick Links Action */}
                                <td className="p-3 align-top text-end whitespace-nowrap">
                                  <div className="flex flex-col items-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      render={
                                        <Link href={orderLinkA} target="_blank">
                                          <ExternalLink className="w-3.5 h-3.5 me-1 text-muted-foreground" />
                                          {t("shiftA")}
                                        </Link>
                                      }
                                      className="h-7 px-2 text-[11px]"
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      render={
                                        <Link href={orderLinkB} target="_blank">
                                          <ExternalLink className="w-3.5 h-3.5 me-1 text-muted-foreground" />
                                          {t("shiftB")}
                                        </Link>
                                      }
                                      className="h-7 px-2 text-[11px]"
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
