"use client";

import React, { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Printer, Search, Loader2 } from "lucide-react";
import { fetchMitarbeiterListeAction } from "@/app/[locale]/admin/reports/actions";
import type { MitarbeiterListeRow } from "@/lib/reports-data";

export function MitarbeiterListeView({
  clients,
  qualifications,
}: {
  clients: Array<{ id: string; facilityName: string }>;
  qualifications: string[];
}) {
  const t = useTranslations("reports");
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastD = new Date(y, now.getMonth() + 1, 0).getDate();

  const [startDate, setStartDate] = useState(`${y}-${m}-01`);
  const [endDate, setEndDate] = useState(`${y}-${m}-${String(lastD).padStart(2, "0")}`);
  const [clientId, setClientId] = useState<string>(clients[0]?.id || "");
  const [qualification, setQualification] = useState("alle");

  const [rows, setRows] = useState<MitarbeiterListeRow[] | null>(null);
  const [selectedClientName, setSelectedClientName] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const handleSearch = () => {
    if (!clientId) return;
    startTransition(async () => {
      const res = await fetchMitarbeiterListeAction({
        startDate,
        endDate,
        clientId,
        qualification: qualification === "alle" ? undefined : qualification,
      });
      setRows(res.rows);
      setSelectedClientName(res.client.facilityName);
    });
  };

  const handlePrint = () => {
    if (!clientId) return;
    const params = new URLSearchParams({
      startDate,
      endDate,
      clientId,
      ...(qualification !== "alle" ? { qualification } : {}),
    });
    window.open(`/api/reports/mitarbeiter-liste/pdf?${params.toString()}`, "_blank");
  };

  const selectedClient = clients.find((c) => c.id === clientId);

  return (
    <div className="w-full space-y-6">
      {/* Filter Card */}
      <Card className="w-full border-border/80 shadow-xs">
        <CardHeader className="bg-muted/30 pb-3.5 border-b border-border/60">
          <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
            {t("mitarbeiterListe.title")}
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
              <label className="text-xs font-medium text-muted-foreground">{t("common.client")}</label>
              <SearchableSelect
                options={clients.map((c) => ({
                  value: c.id,
                  label: c.facilityName,
                  searchTerms: c.facilityName,
                }))}
                value={clientId}
                onValueChange={setClientId}
                placeholder={t("common.client")}
                searchPlaceholder="Kunde suchen..."
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t("common.qualification")}</label>
              <SearchableSelect
                options={[
                  { value: "alle", label: t("common.all") },
                  ...qualifications.map((q) => ({
                    value: q,
                    label: q,
                    searchTerms: q,
                  })),
                ]}
                value={qualification}
                onValueChange={setQualification}
                placeholder={t("common.all")}
                searchPlaceholder="Qualifikation suchen..."
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              disabled={isPending || !clientId}
              className="gap-1.5 h-9 rounded-lg"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {t("common.search")}
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={!clientId}
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
              <CardTitle className="text-base font-semibold">
                {selectedClientName}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vom {startDate} bis {endDate} · {rows.length} Mitarbeiter im Einsatz
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
                  <th className="p-2.5 text-center">Personal-Nr.</th>
                  <th className="p-2.5">{t("mitarbeiterListe.firstName")}</th>
                  <th className="p-2.5">{t("mitarbeiterListe.lastName")}</th>
                  <th className="p-2.5 text-center">{t("mitarbeiterListe.birthDate")}</th>
                  <th className="p-2.5 text-center">{t("mitarbeiterListe.gender")}</th>
                  <th className="p-2.5">{t("mitarbeiterListe.address")}</th>
                  <th className="p-2.5">{t("mitarbeiterListe.phone")}</th>
                  <th className="p-2.5">{t("mitarbeiterListe.email")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      {t("common.noResults")}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-2.5 text-center font-medium text-foreground">
                        {r.internalNumber}
                      </td>
                      <td className="p-2.5 font-semibold">{r.firstName}</td>
                      <td className="p-2.5 font-semibold">{r.lastName}</td>
                      <td className="p-2.5 text-center whitespace-nowrap">{r.birthDate}</td>
                      <td className="p-2.5 text-center">{r.gender}</td>
                      <td className="p-2.5">{r.address}</td>
                      <td className="p-2.5 whitespace-nowrap">{r.phone}</td>
                      <td className="p-2.5 text-muted-foreground">{r.email}</td>
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
