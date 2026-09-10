"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, BarChart3, FileText, CalendarDays, Users, Clock, Car, Calculator, TrendingUp, ArrowRightLeft } from "lucide-react";
import { StundennachweisView } from "./stundennachweis-view";
import { MonatslisteView } from "./monatsliste-view";
import { AuegView } from "./aueg-view";
import { MitarbeiterListeView } from "./mitarbeiter-liste-view";
import { ArbeitszeitkontoView } from "./arbeitszeitkonto-view";
import { ReisespesenView } from "./reisespesen-view";
import { UrlaubBerechnungView } from "./urlaub-berechnung-view";
import { AzkStandView } from "./azk-stand-view";
import { ZeiterfassungTransferView } from "./zeiterfassung-transfer-view";

export type ReportsHubProps = {
  workers: Array<{
    id: string;
    fullName: string;
    internalNumber: string | null;
    qualification: string;
    employmentStartDate?: Date | null;
    employedSince?: Date | null;
  }>;
  clients: Array<{
    id: string;
    facilityName: string;
    internalNumber: string | null;
  }>;
  qualifications: string[];
  kpiContent: React.ReactNode;
};

export function ReportsHub({
  workers,
  clients,
  qualifications,
  kpiContent,
}: ReportsHubProps) {
  const t = useTranslations("reports");
  const [activeTab, setActiveTab] = useState<string>("overview");

  const modules: {
    id: string;
    title: string;
    icon: typeof BarChart3;
    badge: string;
    variant: "red" | "slate";
  }[] = [
    {
      id: "overview",
      title: t("tabs.overview"),
      icon: BarChart3,
      badge: "KPI",
      variant: "slate",
    },
    {
      id: "stundennachweis",
      title: t("tabs.stundennachweis"),
      icon: FileText,
      badge: "PDF",
      variant: "red",
    },
    {
      id: "monatsliste",
      title: t("tabs.monatsliste"),
      icon: CalendarDays,
      badge: "Monat",
      variant: "red",
    },
    {
      id: "aueg",
      title: t("tabs.aueg"),
      icon: FileText,
      badge: "AÜG",
      variant: "slate",
    },
    {
      id: "mitarbeiterListe",
      title: t("tabs.mitarbeiterListe"),
      icon: Users,
      badge: "Team",
      variant: "red",
    },
    {
      id: "arbeitszeitkonto",
      title: t("tabs.arbeitszeitkonto"),
      icon: Clock,
      badge: "AZK",
      variant: "slate",
    },
    {
      id: "reisespesen",
      title: t("tabs.reisespesen"),
      icon: Car,
      badge: "Spesen",
      variant: "red",
    },
    {
      id: "urlaubBerechnung",
      title: t("tabs.urlaubBerechnung"),
      icon: Calculator,
      badge: "Urlaub",
      variant: "slate",
    },
    {
      id: "azkStand",
      title: t("tabs.azkStand"),
      icon: TrendingUp,
      badge: "Saldo",
      variant: "red",
    },
    {
      id: "zeiterfassungTransfer",
      title: t("tabs.zeiterfassungTransfer"),
      icon: ArrowRightLeft,
      badge: "Sync",
      variant: "slate",
    },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Title & Subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mt-1 text-xs sm:text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {/* Internal Security / No-Notification Notice Alert */}
      <div className="flex items-start sm:items-center gap-3 p-3 sm:p-3.5 bg-muted/40 border border-border/80 rounded-xl text-xs text-muted-foreground backdrop-blur-xs">
        <ShieldAlert className="w-4 h-4 mt-0.5 sm:mt-0 flex-shrink-0 text-amber-500" />
        <span className="leading-relaxed">{t("internalNotice")}</span>
      </div>

      {/* Revolutionary 2026 Command Center Cards Grid: Distinct Red & Slate Families */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {modules.map((m) => {
          const Icon = m.icon;
          const isActive = activeTab === m.id;
          const isRed = m.variant === "red";

          return (
            <button
              key={m.id}
              onClick={() => setActiveTab(m.id)}
              className={`group relative flex flex-col justify-between p-3.5 sm:p-4 rounded-2xl border text-start transition-all duration-200 cursor-pointer overflow-hidden ${
                isActive
                  ? isRed
                    ? "bg-gradient-to-br from-rose-600 via-red-600 to-rose-700 text-white shadow-lg shadow-red-600/30 border-red-500 ring-2 ring-red-400/40 scale-[1.02]"
                    : "bg-gradient-to-br from-slate-800 via-slate-900 to-zinc-950 text-white shadow-lg shadow-black/40 border-slate-600 ring-2 ring-slate-400/40 scale-[1.02]"
                  : isRed
                  ? "bg-gradient-to-b from-rose-50/70 via-white to-red-50/40 dark:from-red-950/25 dark:via-zinc-900/80 dark:to-rose-950/15 border-rose-200/80 dark:border-red-900/40 hover:border-rose-300 dark:hover:border-red-800 hover:shadow-rose-500/10 shadow-xs"
                  : "bg-gradient-to-b from-slate-100/70 via-white to-slate-50/40 dark:from-slate-900/40 dark:via-zinc-900/80 dark:to-zinc-950/30 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-slate-500/10 shadow-xs"
              }`}
            >
              {/* Active top subtle accent bar */}
              <div
                className={`absolute top-0 inset-x-0 h-1 transition-all ${
                  isActive
                    ? isRed
                      ? "bg-gradient-to-r from-red-300 via-white to-rose-300 opacity-100"
                      : "bg-gradient-to-r from-slate-300 via-white to-slate-400 opacity-100"
                    : isRed
                    ? "opacity-0 group-hover:opacity-60 bg-rose-400"
                    : "opacity-0 group-hover:opacity-60 bg-slate-400"
                }`}
              />

              <div className="flex items-center justify-between w-full mb-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-108 ${
                    isActive
                      ? isRed
                        ? "bg-white text-red-600 shadow-md shadow-black/10"
                        : "bg-white text-slate-900 shadow-md shadow-black/10"
                      : isRed
                      ? "bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-xs shadow-rose-500/30"
                      : "bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-xs shadow-slate-900/30"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <span
                  className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md transition-colors ${
                    isActive
                      ? "bg-white/20 text-white border border-white/30 backdrop-blur-xs"
                      : isRed
                      ? "bg-rose-100 text-rose-800 border border-rose-200/90 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-900/60"
                      : "bg-slate-200/80 text-slate-700 border border-slate-300/80 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {m.badge}
                </span>
              </div>

              <div>
                <span
                  className={`text-xs sm:text-sm font-semibold line-clamp-2 leading-snug transition-colors ${
                    isActive
                      ? "text-white font-bold"
                      : isRed
                      ? "text-slate-800 dark:text-rose-100 group-hover:text-red-600 dark:group-hover:text-rose-200"
                      : "text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white"
                  }`}
                >
                  {m.title}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Report View - Full Width & Clean */}
      <div className="w-full">
        {activeTab === "overview" && (
          <div className="w-full">{kpiContent}</div>
        )}
        {activeTab === "stundennachweis" && (
          <StundennachweisView clients={clients} qualifications={qualifications} />
        )}
        {activeTab === "monatsliste" && (
          <MonatslisteView workers={workers} clients={clients} />
        )}
        {activeTab === "aueg" && <AuegView />}
        {activeTab === "mitarbeiterListe" && (
          <MitarbeiterListeView clients={clients} qualifications={qualifications} />
        )}
        {activeTab === "arbeitszeitkonto" && (
          <ArbeitszeitkontoView workers={workers} />
        )}
        {activeTab === "reisespesen" && (
          <ReisespesenView workers={workers} />
        )}
        {activeTab === "urlaubBerechnung" && (
          <UrlaubBerechnungView workers={workers} />
        )}
        {activeTab === "azkStand" && <AzkStandView />}
        {activeTab === "zeiterfassungTransfer" && (
          <ZeiterfassungTransferView
            workers={workers}
            clients={clients}
            qualifications={qualifications}
          />
        )}
      </div>
    </div>
  );
}
