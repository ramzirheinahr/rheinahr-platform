"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Calculator, Loader2 } from "lucide-react";
import { calculateUrlaubAction } from "@/app/[locale]/admin/reports/actions";

export function UrlaubBerechnungView({
  workers,
}: {
  workers: Array<{ id: string; fullName: string; internalNumber: string | null }>;
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const y = now.getFullYear();

  const [workerId, setWorkerId] = useState<string>(workers[0]?.id || "");
  const [contractDays, setContractDays] = useState<number>(5);
  const [actualDays, setActualDays] = useState<number>(5);
  const [periodStart, setPeriodStart] = useState<string>(`${y}-01-10`);
  const [periodEnd, setPeriodEnd] = useState<string>(`${y}-09-10`);
  const [takenDays, setTakenDays] = useState<number>(0);

  const [calcResult, setCalcResult] = useState<{
    annualDays: number;
    months: number;
    daysRatio: number;
    monthsRatio: number;
    takenDays: number;
    entitlement: number;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  const handleCalculate = () => {
    startTransition(async () => {
      const res = await calculateUrlaubAction({
        contractDaysPerWeek: contractDays,
        actualDaysPerWeek: actualDays,
        periodStart,
        periodEnd,
        takenDays,
        annualVacationDays: 27,
      });
      setCalcResult(res);
    });
  };

  const selectedWorker = workers.find((w) => w.id === workerId);

  return (
    <div className="w-full space-y-6">
      {/* Input Card */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
                {t("urlaubBerechnung.title")}
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3 items-end">
            <div className="sm:col-span-2 space-y-1.5">
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

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("urlaubBerechnung.contractDaysPerWeek")}:
              </label>
              <Input
                type="number"
                value={contractDays}
                onChange={(e) => setContractDays(parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("urlaubBerechnung.periodStart")}:
              </label>
              <Input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("urlaubBerechnung.periodEnd")}:
              </label>
              <Input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("urlaubBerechnung.actualDaysPerWeek")}:
              </label>
              <Input
                type="number"
                value={actualDays}
                onChange={(e) => setActualDays(parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("urlaubBerechnung.takenDays")}:
              </label>
              <Input
                type="number"
                value={takenDays}
                onChange={(e) => setTakenDays(parseFloat(e.target.value) || 0)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-border/60">
            <Button
              onClick={handleCalculate}
              disabled={isPending || !workerId}
              className="gap-2 h-9 px-4 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
              {t("common.calculate")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Formula Breakdown Card - 2026 AI Computational Widget */}
      {calcResult && (
        <Card className="w-full border-border/80 shadow-xs bg-gradient-to-b from-card to-muted/20 overflow-hidden">
          <CardHeader className="bg-muted/30 pb-3 border-b border-border/60">
            <CardTitle className="text-xs sm:text-sm font-semibold text-foreground flex items-center justify-between">
              <span>{t("urlaubBerechnung.formulaTitle")}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {periodStart} – {periodEnd}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            {/* Calculation Formula Stream */}
            <div className="overflow-x-auto pb-2">
              <div className="min-w-max mx-auto p-4 bg-background/80 backdrop-blur-xs rounded-xl border border-border/80 flex items-center justify-center gap-2.5 sm:gap-3.5 text-sm shadow-xs">
                {/* [Actual / Contract Days] */}
                <div className="flex flex-col items-center bg-card border border-border/80 px-3 py-1.5 rounded-lg shadow-2xs">
                  <span className="font-bold text-foreground">{actualDays}</span>
                  <span className="w-full border-t border-border/80 my-0.5"></span>
                  <span className="font-medium text-muted-foreground text-xs">{contractDays}</span>
                </div>

                <span className="text-lg font-bold text-muted-foreground/60">×</span>

                {/* 27 (Jahresanspruch) */}
                <div className="flex flex-col items-center bg-card border border-border/80 px-3.5 py-2 rounded-lg shadow-2xs">
                  <span className="font-bold text-base text-foreground">{calcResult.annualDays}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Tage/Jahr</span>
                </div>

                <span className="text-lg font-bold text-muted-foreground/60">×</span>

                {/* [Monate / 12] */}
                <div className="flex flex-col items-center bg-card border border-border/80 px-3 py-1.5 rounded-lg shadow-2xs">
                  <span className="font-bold text-foreground">{calcResult.months.toFixed(2)}</span>
                  <span className="w-full border-t border-border/80 my-0.5"></span>
                  <span className="font-medium text-muted-foreground text-xs">12</span>
                </div>

                <span className="text-lg font-bold text-muted-foreground/60">-</span>

                {/* [Genommene Tage] */}
                <div className="flex flex-col items-center bg-card border border-border/80 px-3.5 py-2 rounded-lg shadow-2xs">
                  <span className="font-bold text-foreground">{calcResult.takenDays}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Genommen</span>
                </div>

                <span className="text-lg font-bold text-muted-foreground/60">=</span>

                {/* Result Urlaubsanspruch */}
                <div className="flex items-center gap-3 bg-teal-500/10 dark:bg-teal-500/15 border border-teal-500/30 text-teal-700 dark:text-teal-300 px-4 py-2 rounded-xl">
                  <div className="text-xl sm:text-2xl font-black tracking-tight">
                    {calcResult.entitlement.toFixed(2).replace(".", ",")}
                  </div>
                  <div className="flex flex-col text-start">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {t("urlaubBerechnung.entitlement")}
                    </span>
                    <span className="text-[10px] opacity-80">Tage verbleibend</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Note on upcoming calculation rules from translations */}
            <p className="text-xs text-muted-foreground text-center italic">
              {t("urlaubBerechnung.noteRules")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
