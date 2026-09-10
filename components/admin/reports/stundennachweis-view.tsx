"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Loader2 } from "lucide-react";
import { fetchStundennachweisAction } from "@/app/[locale]/admin/reports/actions";
import type { StundennachweisRow } from "@/lib/reports-data";

export function StundennachweisView({
  clients,
  qualifications,
}: {
  clients: Array<{ id: string; facilityName: string; internalNumber: string | null }>;
  qualifications: string[];
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastD = new Date(y, now.getMonth() + 1, 0).getDate();

  const [startDate, setStartDate] = useState(`${y}-${m}-01`);
  const [endDate, setEndDate] = useState(`${y}-${m}-${String(lastD).padStart(2, "0")}`);
  const [qualification, setQualification] = useState("alle");
  const [clientId, setClientId] = useState<string>(clients[0]?.id || "");

  const [rows, setRows] = useState<StundennachweisRow[] | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    startTransition(async () => {
      const res = await fetchStundennachweisAction({
        startDate,
        endDate,
        qualification: qualification === "alle" ? undefined : qualification,
        clientId: clientId || undefined,
      });
      setRows(res.rows);
      setSelectedClientName(res.client?.facilityName || "");
    });
  };

  const handlePrint = () => {
    const params = new URLSearchParams({
      startDate,
      endDate,
      ...(clientId ? { clientId } : {}),
      ...(qualification !== "alle" ? { qualification } : {}),
    });
    window.open(`/api/reports/stundennachweis/pdf?${params.toString()}`, "_blank");
  };

  const selectedClient = clients.find((c) => c.id === clientId);

  return (
    <div className="w-full space-y-6">
      {/* Selection Filter Dialog Card */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("stundennachweis.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.dateFrom")}</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.dateTo")}</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.qualification")}</label>
              <Select value={qualification} onValueChange={(v) => { if (v !== null) setQualification(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.all")}>
                    {qualification === "alle" ? t("common.all") : qualification}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alle">{t("common.all")}</SelectItem>
                  {qualifications.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.client")}</label>
              <Select value={clientId} onValueChange={(v) => { if (v !== null) setClientId(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.client")}>
                    {selectedClient
                      ? `${selectedClient.facilityName} ${selectedClient.internalNumber ? `(${selectedClient.internalNumber})` : ""}`
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.facilityName} {c.internalNumber ? `(${c.internalNumber})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-border/60">
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/60">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse"></span>
              <span>{t("stundennachweis.sundayNotice")}</span>
            </div>

            <div className="flex items-center gap-2">
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
          </div>
        </CardContent>
      </Card>

      {/* Results View */}
      {rows && (
        <Card className="border-border shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 pb-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Stundennachweis: {selectedClientName || "—"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {startDate} bis {endDate} · {rows.length} Einträge
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              className="gap-1.5 h-8 text-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              {t("common.print")}
            </Button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="bg-muted/60 border-b text-muted-foreground font-semibold">
                  <th className="p-2.5">{t("stundennachweis.shiftDate")}</th>
                  <th className="p-2.5">{t("common.worker")}</th>
                  <th className="p-2.5 text-center">{t("stundennachweis.livingArea")}</th>
                  <th className="p-2.5 text-center">{t("stundennachweis.from")}</th>
                  <th className="p-2.5 text-center">{t("stundennachweis.to")}</th>
                  <th className="p-2.5 text-right">{t("stundennachweis.hours")}</th>
                  <th className="p-2.5 text-right">{t("stundennachweis.hoursWithoutPause")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr
                      key={i}
                      className={
                        r.isSunday
                          ? "bg-yellow-100/90 dark:bg-yellow-950/40 text-amber-950 dark:text-amber-100 font-medium"
                          : "hover:bg-muted/30 transition-colors"
                      }
                    >
                      <td className="p-2.5 whitespace-nowrap">{r.shiftDate}</td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span className="font-semibold">{r.workerName}</span>
                        {r.workerNumber && (
                          <span className="text-muted-foreground ml-1.5 font-normal">
                            ({r.workerNumber})
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-center">{r.livingArea || "-----"}</td>
                      <td className="p-2.5 text-center">{r.startTime}</td>
                      <td className="p-2.5 text-center">{r.endTime}</td>
                      <td className="p-2.5 text-right font-medium">
                        {r.hours.toFixed(2).replace(".", ",")}
                      </td>
                      <td className="p-2.5 text-right font-semibold">
                        {r.hoursWithoutPause.toFixed(2).replace(".", ",")}
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
