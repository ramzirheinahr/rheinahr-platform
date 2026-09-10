"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Loader2 } from "lucide-react";
import { fetchMonatslisteAction } from "@/app/[locale]/admin/reports/actions";
import type { MonatslisteRow } from "@/lib/reports-data";

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

export function MonatslisteView({
  workers,
  clients,
}: {
  workers: Array<{ id: string; fullName: string; internalNumber: string | null }>;
  clients: Array<{ id: string; facilityName: string }>;
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [workerId, setWorkerId] = useState<string>(workers[0]?.id || "");
  const [clientId, setClientId] = useState<string>("all");

  const [rows, setRows] = useState<MonatslisteRow[] | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!workerId) return;
    startTransition(async () => {
      const res = await fetchMonatslisteAction({
        year,
        month,
        workerId,
        clientId: clientId === "all" ? undefined : clientId,
      });
      setRows(res.rows);
      setSelectedWorkerName(
        `${res.worker.fullName} ${res.worker.internalNumber ? `- ${res.worker.internalNumber}` : ""}`
      );
    });
  };

  const handlePrint = () => {
    if (!workerId) return;
    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
      workerId,
      ...(clientId !== "all" ? { clientId } : {}),
    });
    window.open(`/api/reports/monatsliste/pdf?${params.toString()}`, "_blank");
  };

  const selectedWorker = workers.find((w) => w.id === workerId);
  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedMonth = MONTHS.find((m) => m.value === month);

  return (
    <div className="w-full space-y-6">
      {/* Dialog Filter Card */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("monatsliste.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.year")}</label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.month")}</label>
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
              <label className="text-xs font-medium text-muted-foreground">{t("common.worker")}</label>
              <Select value={workerId} onValueChange={(v) => { if (v !== null) setWorkerId(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.worker")}>
                    {selectedWorker
                      ? `${selectedWorker.fullName} ${selectedWorker.internalNumber ? `(${selectedWorker.internalNumber})` : ""}`
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.fullName} {w.internalNumber ? `(${w.internalNumber})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.client")}</label>
              <Select value={clientId} onValueChange={(v) => { if (v !== null) setClientId(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.allClients")}>
                    {clientId === "all" ? t("common.allClients") : (selectedClient?.facilityName || "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.allClients")}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.facilityName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              disabled={isPending || !workerId}
              className="gap-1.5 h-9 rounded-lg"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t("common.search")}
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

      {/* Table Results */}
      {rows && (
        <Card className="w-full border-border/80 shadow-xs overflow-hidden">
          <CardHeader className="bg-muted/30 pb-3 border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-foreground">
                {selectedWorkerName}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Jahr: {year} · Monat: {month} · {rows.length} Tage erfasst
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              className="gap-1.5 h-8 text-xs rounded-lg"
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
                  <th className="p-2.5 text-center">{t("monatsliste.comes")} 1</th>
                  <th className="p-2.5 text-center">{t("monatsliste.leaves")} 1</th>
                  <th className="p-2.5 text-center">{t("monatsliste.pause")} 1</th>
                  <th className="p-2.5 text-center">{t("monatsliste.comes")} 2</th>
                  <th className="p-2.5 text-center">{t("monatsliste.leaves")} 2</th>
                  <th className="p-2.5 text-center">{t("monatsliste.pause")} 2</th>
                  <th className="p-2.5 text-right">{t("monatsliste.sum")}</th>
                  <th className="p-2.5">{t("monatsliste.client")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 whitespace-nowrap font-medium">{r.date}</td>
                      <td className="p-2.5 text-center">{r.shift1.kommt}</td>
                      <td className="p-2.5 text-center">{r.shift1.geht}</td>
                      <td className="p-2.5 text-center">{r.shift1.pause}</td>
                      <td className="p-2.5 text-center">{r.shift2.kommt}</td>
                      <td className="p-2.5 text-center">{r.shift2.geht}</td>
                      <td className="p-2.5 text-center">{r.shift2.pause}</td>
                      <td className="p-2.5 text-right font-bold text-foreground">
                        {r.hours.toFixed(2).replace(".", ",")}
                      </td>
                      <td className="p-2.5 font-medium">{r.customerName}</td>
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
