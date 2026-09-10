"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Printer, Search, Loader2 } from "lucide-react";
import { fetchAuegAction } from "@/app/[locale]/admin/reports/actions";
import type { AuegRow } from "@/lib/reports-data";

export function AuegView() {
  const t = useTranslations("reports");
  const now = new Date();
  const y = now.getFullYear();

  const [startDate, setStartDate] = useState(`${y}-01-01`);
  const [endDate, setEndDate] = useState(`${y}-12-31`);

  const [rows, setRows] = useState<AuegRow[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    startTransition(async () => {
      const res = await fetchAuegAction({ startDate, endDate });
      setRows(res.rows);
    });
  };

  const handlePrint = () => {
    const params = new URLSearchParams({ startDate, endDate });
    window.open(`/api/reports/aueg/pdf?${params.toString()}`, "_blank");
  };

  return (
    <div className="w-full space-y-6">
      {/* Filter Card */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("tabs.aueg")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.dateFrom")}:</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.dateTo")}:</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              disabled={isPending}
              className="gap-1.5 h-9 rounded-lg"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t("common.search")}
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={!startDate || !endDate}
              className="gap-1.5 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
            >
              <Printer className="w-4 h-4" />
              {t("common.print")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result Table */}
      {rows && (
        <Card className="w-full border-border/80 shadow-xs overflow-hidden">
          <div className="p-3.5 bg-muted/40 border-b border-border/60 flex flex-wrap justify-between items-center gap-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm text-foreground">{t("aueg.title")}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">Firma: RheinAhr Dienstleistungen GmbH</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-medium text-foreground">{t("aueg.auegNr")}</span>
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
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="bg-muted/60 border-b text-muted-foreground font-semibold">
                  <th className="p-2.5 text-center">Lfd. Nr.</th>
                  <th className="p-2.5">Nachname, Vorname</th>
                  <th className="p-2.5 text-center">{t("mitarbeiterListe.birthDate")}</th>
                  <th className="p-2.5 text-center">{t("aueg.entry")}</th>
                  <th className="p-2.5 text-center">{t("aueg.exit")}</th>
                  <th className="p-2.5">{t("aueg.activity")}</th>
                  <th className="p-2.5 text-center">{t("aueg.workingHours")}</th>
                  <th className="p-2.5 text-center">{t("aueg.deploymentPeriods")}</th>
                  <th className="p-2.5">{t("aueg.hirer")}</th>
                  <th className="p-2.5">{t("aueg.industry")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 text-center font-medium">{r.internalNumber}</td>
                      <td className="p-2.5 font-semibold whitespace-nowrap">
                        {r.lastName}, {r.firstName}
                      </td>
                      <td className="p-2.5 text-center whitespace-nowrap">{r.birthDate}</td>
                      <td className="p-2.5 text-center whitespace-nowrap">{r.entryDate}</td>
                      <td className="p-2.5 text-center whitespace-nowrap">{r.exitDate}</td>
                      <td className="p-2.5">{r.qualification}</td>
                      <td className="p-2.5 text-center font-medium">{r.employmentType}</td>
                      <td className="p-2 text-center">
                        {r.deployments.map((d, dIdx) => (
                          <div key={dIdx} className="py-0.5 text-[11px] whitespace-nowrap">
                            {d.period}
                          </div>
                        ))}
                      </td>
                      <td className="p-2">
                        {r.deployments.map((d, dIdx) => (
                          <div key={dIdx} className="py-0.5 text-[11px] font-medium">
                            {d.clientName}
                          </div>
                        ))}
                      </td>
                      <td className="p-2">
                        {r.deployments.map((d, dIdx) => (
                          <div key={dIdx} className="py-0.5 text-[11px] text-muted-foreground">
                            {d.industry}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
