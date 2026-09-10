"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, ArrowRightLeft, Search, Loader2, Check, X } from "lucide-react";
import { fetchMonatslisteAction, transferOrCopyShiftsAction } from "@/app/[locale]/admin/reports/actions";
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

export function ZeiterfassungTransferView({
  workers,
  clients,
  qualifications,
}: {
  workers: Array<{ id: string; fullName: string; internalNumber: string | null; qualification: string }>;
  clients: Array<{ id: string; facilityName: string }>;
  qualifications: string[];
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [workerId, setWorkerId] = useState<string>(workers[0]?.id || "");
  const [clientId, setClientId] = useState<string>(clients[0]?.id || "");
  const [qualification, setQualification] = useState<string>(qualifications[0] || "Pflegehilfskraft");

  const [rows, setRows] = useState<MonatslisteRow[] | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);

  // Transfer Target states
  const [targetYear, setTargetYear] = useState<number>(now.getFullYear());
  const [targetMonth, setTargetMonth] = useState<number>(now.getMonth() + 1);
  const [targetWorkerId, setTargetWorkerId] = useState<string>(workers[1]?.id || workers[0]?.id || "");
  const [targetClientId, setTargetClientId] = useState<string>(clients[0]?.id || "");
  const [targetQualification, setTargetQualification] = useState<string>(qualifications[0] || "Pflegehilfskraft");

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!workerId) return;
    startTransition(async () => {
      const res = await fetchMonatslisteAction({
        year,
        month,
        workerId,
        clientId: clientId || undefined,
      });
      setRows(res.rows);
    });
  };

  const handleExecute = (mode: "copy" | "transfer") => {
    if (!workerId || !targetWorkerId) return;
    startTransition(async () => {
      const res = await transferOrCopyShiftsAction({
        mode,
        source: {
          year,
          month,
          workerId,
          clientId: clientId || undefined,
        },
        target: {
          year: targetYear,
          month: targetMonth,
          workerId: targetWorkerId,
          clientId: targetClientId || undefined,
        },
      });

      setIsTransferModalOpen(false);
      setActionMessage(`${mode === "copy" ? "Kopiert" : "Übertragen"}: ${res.count} Schichten.`);
      setTimeout(() => setActionMessage(null), 4000);
      handleSearch();
    });
  };

  const selectedMonth = MONTHS.find((m) => m.value === month);
  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedWorker = workers.find((w) => w.id === workerId);

  return (
    <div className="w-full space-y-6">
      {/* Selection Form */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("zeiterfassungTransfer.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              <label className="text-xs font-medium text-muted-foreground">{t("common.qualification")}:</label>
              <Select value={qualification} onValueChange={(v) => { if (v !== null) setQualification(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.qualification")}>
                    {qualification}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {qualifications.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.client")}:</label>
              <Select value={clientId} onValueChange={(v) => { if (v !== null) setClientId(v); }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("common.client")}>
                    {selectedClient?.facilityName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.facilityName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("common.worker")}:</label>
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

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-border/60">
            {actionMessage ? (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" />
                {actionMessage}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t("internalNotice")}</span>
            )}

            <div className="flex gap-2">
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
                onClick={() => setIsTransferModalOpen(true)}
                disabled={!workerId}
                className="gap-1.5 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs"
              >
                <ArrowRightLeft className="w-4 h-4" />
                {t("tabs.zeiterfassungTransfer")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid of Days */}
      {rows && (
        <Card className="w-full border-border/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="bg-muted/60 border-b text-muted-foreground font-semibold">
                  <th className="p-2">{t("stundennachweis.shiftDate")}</th>
                  <th className="p-2 text-center bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100">
                    Code 1
                  </th>
                  <th className="p-2 text-center">{t("monatsliste.comes")} 1</th>
                  <th className="p-2 text-center">{t("monatsliste.leaves")} 1</th>
                  <th className="p-2 text-center">{t("monatsliste.pause")} 1</th>
                  <th className="p-2 text-center">{t("stundennachweis.livingArea")} 1</th>
                  <th className="p-2 text-center bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100">
                    Code 2
                  </th>
                  <th className="p-2 text-center">{t("monatsliste.comes")} 2</th>
                  <th className="p-2 text-center">{t("monatsliste.leaves")} 2</th>
                  <th className="p-2 text-center">{t("monatsliste.pause")} 2</th>
                  <th className="p-2 text-center">{t("stundennachweis.livingArea")} 2</th>
                  <th className="p-2 text-right">{t("monatsliste.sum")}</th>
                  <th className="p-2 text-right">Vorschuss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2 font-medium whitespace-nowrap bg-muted/20">{r.date}</td>
                      <td className="p-2 text-center bg-emerald-50/50 dark:bg-emerald-950/20"></td>
                      <td className="p-2 text-center">{r.shift1.kommt}</td>
                      <td className="p-2 text-center">{r.shift1.geht}</td>
                      <td className="p-2 text-center">{r.shift1.pause}</td>
                      <td className="p-2 text-center"></td>
                      <td className="p-2 text-center bg-emerald-50/50 dark:bg-emerald-950/20"></td>
                      <td className="p-2 text-center">{r.shift2.kommt}</td>
                      <td className="p-2 text-center">{r.shift2.geht}</td>
                      <td className="p-2 text-center">{r.shift2.pause}</td>
                      <td className="p-2 text-center"></td>
                      <td className="p-2 text-right font-bold text-blue-700 dark:text-blue-400">
                        {r.hours.toFixed(2).replace(".", ",")}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">0,00</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Übertragen Dialog Modal (Image 18) */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              {t("zeiterfassungTransfer.title")}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 sm:grid-cols-2 pt-2">
            {/* Left Column: Von (Source) */}
            <div className="space-y-3 p-4 bg-muted/20 rounded-xl border border-border/70">
              <div className="bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-semibold rounded-lg">
                {t("zeiterfassungTransfer.sourceVon")}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t("common.year")}:</label>
                  <Input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value, 10) || year)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t("common.month")}:</label>
                  <Select value={String(month)} onValueChange={(v) => { if (v) setMonth(parseInt(v, 10)); }}>
                    <SelectTrigger className="h-8 text-xs w-full">
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
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.worker")}:</label>
                <Select value={workerId} onValueChange={(v) => { if (v !== null) setWorkerId(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
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

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.client")}:</label>
                <Select value={clientId} onValueChange={(v) => { if (v !== null) setClientId(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder={t("common.client")}>
                      {selectedClient?.facilityName}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.facilityName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.qualification")}:</label>
                <Select value={qualification} onValueChange={(v) => { if (v !== null) setQualification(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder={t("common.qualification")}>
                      {qualification}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {qualifications.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Right Column: Bis (Destination) */}
            <div className="space-y-3 p-4 bg-muted/20 rounded-xl border border-border/70">
              <div className="bg-primary/10 text-primary border border-primary/20 px-3 py-1 text-xs font-semibold rounded-lg">
                {t("zeiterfassungTransfer.targetBis")}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t("common.year")}:</label>
                  <Input
                    type="number"
                    value={targetYear}
                    onChange={(e) => setTargetYear(parseInt(e.target.value, 10) || targetYear)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">{t("common.month")}:</label>
                  <Select value={String(targetMonth)} onValueChange={(v) => { if (v) setTargetMonth(parseInt(v, 10)); }}>
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue placeholder={t("common.month")}>
                        {MONTHS.find((m) => m.value === targetMonth)?.label}
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
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.worker")}:</label>
                <Select value={targetWorkerId} onValueChange={(v) => { if (v !== null) setTargetWorkerId(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder={t("common.worker")}>
                      {(() => {
                        const tw = workers.find((w) => w.id === targetWorkerId);
                        return tw ? `${tw.fullName} ${tw.internalNumber ? `(${tw.internalNumber})` : ""}` : undefined;
                      })()}
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

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.client")}:</label>
                <Select value={targetClientId} onValueChange={(v) => { if (v !== null) setTargetClientId(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder={t("common.client")}>
                      {clients.find((c) => c.id === targetClientId)?.facilityName}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.facilityName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{t("common.qualification")}:</label>
                <Select value={targetQualification} onValueChange={(v) => { if (v !== null) setTargetQualification(v); }}>
                  <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder={t("common.qualification")}>
                      {targetQualification}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {qualifications.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Action buttons (Image 18) */}
          <div className="flex flex-col gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => handleExecute("copy")}
              disabled={isPending || workerId === targetWorkerId}
              className="gap-2 h-9 w-full text-xs font-semibold"
            >
              <Copy className="w-4 h-4 text-blue-600" />
              {t("zeiterfassungTransfer.copyAndSave")}
            </Button>

            <Button
              variant="outline"
              onClick={() => handleExecute("transfer")}
              disabled={isPending || workerId === targetWorkerId}
              className="gap-2 h-9 w-full text-xs font-semibold"
            >
              <ArrowRightLeft className="w-4 h-4 text-amber-600" />
              {t("zeiterfassungTransfer.transferAndSave")}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsTransferModalOpen(false)}
              className="gap-1.5 h-8 text-xs text-muted-foreground self-center mt-1"
            >
              <X className="w-3.5 h-3.5 text-red-500" />
              {t("common.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
