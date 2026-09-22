"use client";

import { useState, useMemo } from "react";
import { Link } from "@/i18n/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, UserCircle, Search, ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

export interface TopClient {
  id: string;
  name: string;
  orderCount: number;
}

export interface AttentionWorker {
  id: string;
  name: string;
  currentBalance?: number;
  carryoverHours?: number;
}

interface TopListsProps {
  topClients: TopClient[];
  attentionWorkers: AttentionWorker[];
}

export function TopLists({ topClients, attentionWorkers }: TopListsProps) {
  const t = useTranslations("dashboard");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [filterType, setFilterType] = useState<"all" | "negative" | "positive">("all");

  const totalMinus = useMemo(
    () => attentionWorkers.filter((w) => (w.currentBalance ?? w.carryoverHours ?? 0) < 0).length,
    [attentionWorkers]
  );
  const totalPlus = useMemo(
    () => attentionWorkers.filter((w) => (w.currentBalance ?? w.carryoverHours ?? 0) > 0).length,
    [attentionWorkers]
  );

  const processedWorkers = useMemo(() => {
    return attentionWorkers
      .map((w) => ({
        ...w,
        balance: w.currentBalance ?? w.carryoverHours ?? 0,
      }))
      .filter((w) => {
        if (search.trim()) {
          const q = search.toLowerCase();
          if (!w.name.toLowerCase().includes(q)) return false;
        }
        if (filterType === "negative") return w.balance < 0;
        if (filterType === "positive") return w.balance > 0;
        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "asc") {
          // Ascending: Lowest balance (most negative) first (-143h ... +120h)
          return a.balance - b.balance;
        } else {
          // Descending: Highest balance (most positive) first (+120h ... -143h)
          return b.balance - a.balance;
        }
      });
  }, [attentionWorkers, search, sortOrder, filterType]);

  return (
    <div className="grid gap-4 md:grid-cols-2 items-start">
      {/* Top Clients Card */}
      <Card className="flex flex-col h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              {t("topClientsTitle")}
            </span>
            <Badge variant="outline" className="text-xs font-normal">
              {topClients.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          {topClients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t("noData")}</p>
          ) : (
            <ul className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {topClients.map((client) => (
                <li key={client.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="bg-primary/10 p-2 rounded-full shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="truncate">
                      <Link href={`/admin/clients/${client.id}`} className="text-sm font-medium hover:underline truncate">
                        {client.name}
                      </Link>
                    </div>
                  </div>
                  <div className="text-xs font-bold bg-muted px-2.5 py-1 rounded-md shrink-0">
                    {client.orderCount} {t("shiftsUnit")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Employee Hours Account Card (Dynamic, Interactive, Search & Sortable) */}
      <Card className="flex flex-col h-full">
        <CardHeader className="pb-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UserCircle className="w-4 h-4 text-primary" />
              {t("stundenkontoTitle")}
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                className="h-7 px-2 text-xs gap-1 font-normal"
                title={sortOrder === "asc" ? t("sortAsc") : t("sortDesc")}
              >
                {sortOrder === "asc" ? (
                  <>
                    <ArrowDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                    <span className="hidden sm:inline">{t("sortAsc")}</span>
                  </>
                ) : (
                  <>
                    <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="hidden sm:inline">{t("sortDesc")}</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Search bar & filter pills */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("searchWorker")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7.5 pl-8 text-xs rounded-md"
              />
            </div>

            <div className="flex items-center gap-1 text-xs">
              <Button
                type="button"
                size="sm"
                variant={filterType === "all" ? "default" : "ghost"}
                onClick={() => setFilterType("all")}
                className="h-6 px-2 text-[11px] rounded-full"
              >
                {t("filterAll")} ({attentionWorkers.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filterType === "negative" ? "default" : "ghost"}
                onClick={() => setFilterType("negative")}
                className="h-6 px-2 text-[11px] rounded-full text-red-600 dark:text-red-400"
              >
                {t("filterMinus")} ({totalMinus})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={filterType === "positive" ? "default" : "ghost"}
                onClick={() => setFilterType("positive")}
                className="h-6 px-2 text-[11px] rounded-full text-emerald-600 dark:text-emerald-400"
              >
                {t("filterPlus")} ({totalPlus})
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 pt-1">
          {processedWorkers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search.trim() ? t("noWorkersFound") : t("allBalanced")}
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
              {processedWorkers.map((worker) => {
                const isPositive = worker.balance > 0;
                const isNegative = worker.balance < 0;

                return (
                  <li
                    key={worker.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="bg-primary/10 p-1.5 rounded-full shrink-0">
                        <UserCircle className="w-4 h-4 text-primary" />
                      </div>
                      <Link
                        href={`/admin/workers/${worker.id}/schedule`}
                        className="text-sm font-medium hover:underline truncate"
                        title={worker.name}
                      >
                        {worker.name}
                      </Link>
                    </div>

                    {/* True positive / negative representation */}
                    <div
                      className={`text-xs font-bold px-2.5 py-1 rounded-md shrink-0 tabular-nums ${
                        isPositive
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : isNegative
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-muted text-muted-foreground font-semibold"
                      }`}
                    >
                      {isPositive ? `+${worker.balance.toFixed(1)}` : worker.balance.toFixed(1)} h
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
