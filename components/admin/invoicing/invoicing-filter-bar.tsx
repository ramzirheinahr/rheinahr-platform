"use client";

import React, { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Search, RotateCcw, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InvoicingFilterBarProps {
  initialFrom: string;
  initialTo: string;
  initialQuery: string;
  defaultFrom: string;
  defaultTo: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function InvoicingFilterBar({
  initialFrom,
  initialTo,
  initialQuery,
  defaultFrom,
  defaultTo,
}: InvoicingFilterBarProps) {
  const t = useTranslations("invoicing");
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [query, setQuery] = useState(initialQuery);

  // Compute "This Month"
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonthNum = now.getUTCMonth() + 1;
  const currentMonthLastDay = new Date(Date.UTC(currentYear, currentMonthNum, 0)).getUTCDate();
  const thisMonthFrom = `${currentYear}-${pad(currentMonthNum)}-01`;
  const thisMonthTo = `${currentYear}-${pad(currentMonthNum)}-${pad(currentMonthLastDay)}`;

  // Compute "Last Month"
  const prevDate = new Date(Date.UTC(currentYear, currentMonthNum - 2, 1));
  const prevYear = prevDate.getUTCFullYear();
  const prevMonthNum = prevDate.getUTCMonth() + 1;
  const prevMonthLastDay = new Date(Date.UTC(prevYear, prevMonthNum, 0)).getUTCDate();
  const lastMonthFrom = `${prevYear}-${pad(prevMonthNum)}-01`;
  const lastMonthTo = `${prevYear}-${pad(prevMonthNum)}-${pad(prevMonthLastDay)}`;

  // Generate selectable months from July 2026 (start of operations) up to current month
  const months: Array<{ value: string; from: string; to: string; label: string }> = [];
  const startYear = 2026;
  const startMonth = 7;
  let cursor = new Date(Date.UTC(currentYear, currentMonthNum - 1, 1));
  const minDate = new Date(Date.UTC(startYear, startMonth - 1, 1));

  while (cursor >= minDate) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const lDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const fStr = `${y}-${pad(m)}-01`;
    const tStr = `${y}-${pad(m)}-${pad(lDay)}`;
    const label = new Intl.DateTimeFormat("de-DE", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(cursor);
    months.push({ value: `${y}-${pad(m)}`, from: fStr, to: tStr, label });
    cursor = new Date(Date.UTC(y, m - 2, 1));
  }

  const isAllActive = from === defaultFrom && to === defaultTo;
  const isThisMonthActive = from === thisMonthFrom && to === thisMonthTo;
  const isLastMonthActive = from === lastMonthFrom && to === lastMonthTo;

  // Active month dropdown value if matching exactly one month
  const activeMonth = months.find((m) => m.from === from && m.to === to);
  const activeMonthValue = activeMonth ? activeMonth.value : undefined;

  const isModified = from !== defaultFrom || to !== defaultTo || query.trim() !== "";

  const applyFilters = (targetFrom: string, targetTo: string, targetQ?: string) => {
    setFrom(targetFrom);
    setTo(targetTo);
    const qValue = targetQ !== undefined ? targetQ : query;
    if (targetQ !== undefined) setQuery(targetQ);

    const params = new URLSearchParams();
    if (targetFrom) params.set("from", targetFrom);
    if (targetTo) params.set("to", targetTo);
    if (qValue.trim()) params.set("q", qValue.trim());

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters(from, to, query);
  };

  return (
    <div className="bg-white border rounded-xl shadow-xs p-4 space-y-3.5">
      {/* 1. Quick Presets Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mr-1 select-none">
            <Sparkles className="size-3.5 text-amber-500" />
            {t("quickFilter")}:
          </span>

          <Button
            type="button"
            variant={isAllActive ? "default" : "outline"}
            size="sm"
            onClick={() => applyFilters(defaultFrom, defaultTo)}
            disabled={isPending}
            className={cn(
              "h-8 text-xs rounded-lg px-3 transition-colors font-medium",
              isAllActive
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            {t("allInvoicesPreset")}
          </Button>

          <Button
            type="button"
            variant={isThisMonthActive ? "default" : "outline"}
            size="sm"
            onClick={() => applyFilters(thisMonthFrom, thisMonthTo)}
            disabled={isPending}
            className={cn(
              "h-8 text-xs rounded-lg px-3 transition-colors font-medium",
              isThisMonthActive
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            {t("thisMonthPreset")}
          </Button>

          <Button
            type="button"
            variant={isLastMonthActive ? "default" : "outline"}
            size="sm"
            onClick={() => applyFilters(lastMonthFrom, lastMonthTo)}
            disabled={isPending}
            className={cn(
              "h-8 text-xs rounded-lg px-3 transition-colors font-medium",
              isLastMonthActive
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            {t("lastMonthPreset")}
          </Button>

          <div className="w-[170px]">
            <Select
              value={activeMonthValue || ""}
              onValueChange={(val) => {
                if (!val) return;
                const target = months.find((m) => m.value === val);
                if (target) applyFilters(target.from, target.to);
              }}
              disabled={isPending}
            >
              <SelectTrigger className="h-8 text-xs bg-white border-slate-200">
                <SelectValue placeholder={t("selectMonthPreset")} />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value} className="text-xs">
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isModified && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => applyFilters(defaultFrom, defaultTo, "")}
            disabled={isPending}
            className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5 px-2.5 rounded-lg"
          >
            <RotateCcw className="size-3" />
            {t("resetFilter")}
          </Button>
        )}
      </div>

      {/* 2. Search & Exact Date Inputs Form */}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[220px]">
          <Label htmlFor="q" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Search className="size-3.5 text-slate-400" />
            {t("search")}
          </Label>
          <div className="relative">
            <Input
              id="q"
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 text-sm pr-7"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  applyFilters(from, to, "");
                }}
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1.5 w-full sm:w-[160px]">
          <Label htmlFor="from" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Calendar className="size-3.5 text-slate-400" />
            {t("from")}
          </Label>
          <Input
            id="from"
            name="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 text-sm font-mono"
          />
        </div>

        <div className="space-y-1.5 w-full sm:w-[160px]">
          <Label htmlFor="to" className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Calendar className="size-3.5 text-slate-400" />
            {t("to")}
          </Label>
          <Input
            id="to"
            name="to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 text-sm font-mono"
          />
        </div>

        <Button
          type="submit"
          variant="default"
          disabled={isPending}
          className="h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg shadow-xs gap-1.5"
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {t("apply")}
        </Button>
      </form>
    </div>
  );
}
