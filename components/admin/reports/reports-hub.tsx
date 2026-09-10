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

  const modules = [
    {
      id: "overview",
      title: t("tabs.overview"),
      icon: BarChart3,
      color: "from-blue-500/15 to-blue-600/5 text-blue-600 dark:text-blue-400 border-blue-500/20",
    },
    {
      id: "stundennachweis",
      title: t("tabs.stundennachweis"),
      icon: FileText,
      color: "from-indigo-500/15 to-indigo-600/5 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    },
    {
      id: "monatsliste",
      title: t("tabs.monatsliste"),
      icon: CalendarDays,
      color: "from-emerald-500/15 to-emerald-600/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    {
      id: "aueg",
      title: t("tabs.aueg"),
      icon: FileText,
      color: "from-sky-500/15 to-sky-600/5 text-sky-600 dark:text-sky-400 border-sky-500/20",
    },
    {
      id: "mitarbeiterListe",
      title: t("tabs.mitarbeiterListe"),
      icon: Users,
      color: "from-violet-500/15 to-violet-600/5 text-violet-600 dark:text-violet-400 border-violet-500/20",
    },
    {
      id: "arbeitszeitkonto",
      title: t("tabs.arbeitszeitkonto"),
      icon: Clock,
      color: "from-amber-500/15 to-amber-600/5 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
    {
      id: "reisespesen",
      title: t("tabs.reisespesen"),
      icon: Car,
      color: "from-rose-500/15 to-rose-600/5 text-rose-600 dark:text-rose-400 border-rose-500/20",
    },
    {
      id: "urlaubBerechnung",
      title: t("tabs.urlaubBerechnung"),
      icon: Calculator,
      color: "from-teal-500/15 to-teal-600/5 text-teal-600 dark:text-teal-400 border-teal-500/20",
    },
    {
      id: "azkStand",
      title: t("tabs.azkStand"),
      icon: TrendingUp,
      color: "from-orange-500/15 to-orange-600/5 text-orange-600 dark:text-orange-400 border-orange-500/20",
    },
    {
      id: "zeiterfassungTransfer",
      title: t("tabs.zeiterfassungTransfer"),
      icon: ArrowRightLeft,
      color: "from-purple-500/15 to-purple-600/5 text-purple-600 dark:text-purple-400 border-purple-500/20",
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

      {/* Modern 2026 AI Interactive Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        {modules.map((m) => {
          const Icon = m.icon;
          const isActive = activeTab === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setActiveTab(m.id)}
              className={`group relative flex flex-col items-start p-3 sm:p-4 rounded-xl border text-start transition-all duration-200 cursor-pointer overflow-hidden ${
                isActive
                  ? "bg-card shadow-sm border-primary ring-2 ring-primary/20 scale-[1.01]"
                  : "bg-card/60 hover:bg-card hover:border-border/80 border-border/50 hover:shadow-xs"
              }`}
            >
              <div
                className={`absolute top-0 inset-x-0 h-0.5 transition-opacity ${
                  isActive ? "bg-primary opacity-100" : "opacity-0 group-hover:opacity-40 bg-muted-foreground"
                }`}
              />

              <div className="flex items-center justify-between w-full mb-2.5">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br border transition-transform duration-200 group-hover:scale-105 ${m.color}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                )}
              </div>

              <span
                className={`text-xs sm:text-sm font-semibold line-clamp-2 leading-snug transition-colors ${
                  isActive ? "text-foreground" : "text-foreground/85 group-hover:text-foreground"
                }`}
              >
                {m.title}
              </span>
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
