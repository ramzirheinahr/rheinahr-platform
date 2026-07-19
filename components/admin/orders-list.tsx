"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { ChevronRight, ListFilter, Check, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { OrderStatus } from "@prisma/client";

export type OrderGroupSummary = {
  key: string;
  facilityName: string;
  range: string;
  shiftsCount: number;
  netLabel: string;
  status: OrderStatus;
  qualification: string;
  cancelled: boolean;
  isFullyCompleted?: boolean;
  timestamp?: number;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(g: OrderGroupSummary, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = normalize(g.facilityName);
  return tokens.every((tok) => hay.includes(tok));
}

// Elegant, chip-based status filter over the request list (inspired by the
// reference facet-filter UI): a "Status" chip opens a popover of toggleable
// statuses; each active status shows as a removable pill, with a "clear" action.
// Filtering happens client-side over the already-loaded requests — no reload.
export function OrdersList({
  groups,
  statuses,
  basePath = "/admin/orders",
}: {
  groups: OrderGroupSummary[];
  statuses: OrderStatus[];
  basePath?: string;
}) {
  const t = useTranslations("orders");
  const es = useTranslations("enums.orderStatus");
  const eq = useTranslations("enums.qualification");
  const [selected, setSelected] = useState<Set<OrderStatus>>(new Set());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "facility_asc" | "facility_desc">("date_desc");
  const [showCompleted, setShowCompleted] = useState(true);
  const [showIncomplete, setShowIncomplete] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // How many requests carry each status — shown next to the option for context.
  const counts = useMemo(() => {
    const m = new Map<OrderStatus, number>();
    for (const g of groups) m.set(g.status, (m.get(g.status) ?? 0) + 1);
    return m;
  }, [groups]);

  const filteredAndSorted = useMemo(() => {
    let result = groups;

    result = result.filter(g => {
      if (g.isFullyCompleted && !showCompleted) return false;
      if (!g.isFullyCompleted && !showIncomplete) return false;
      return true;
    });

    if (query) {
      result = result.filter((g) => matches(g, query));
    }
    // Explicit selection wins — show exactly the chosen statuses.
    if (selected.size > 0) {
      result = result.filter((g) => selected.has(g.status));
    } else {
      // Default view hides finished/cancelled requests to keep the list actionable;
      // the user can still reveal them by selecting those statuses in the filter.
      result = result.filter(
        (g) => !g.cancelled && g.status !== "completed" && g.status !== "cancelled",
      );
    }

    return result.sort((a, b) => {
      const ta = a.timestamp ?? 0;
      const tb = b.timestamp ?? 0;
      switch (sortBy) {
        case "date_asc": return ta - tb;
        case "date_desc": return tb - ta;
        case "facility_asc": return a.facilityName.localeCompare(b.facilityName);
        case "facility_desc": return b.facilityName.localeCompare(a.facilityName);
        default: return 0;
      }
    });
  }, [groups, selected, query, showCompleted, showIncomplete, sortBy]);

  function toggle(s: OrderStatus) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const chip =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors";

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs sm:w-auto sm:min-w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 ps-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className={cn(chip, "border h-9 py-0 outline-none")}
        >
          <option value="date_desc">{t("sortDateDesc")}</option>
          <option value="date_asc">{t("sortDateAsc")}</option>
          <option value="facility_asc">{t("sortFacilityAsc")}</option>
          <option value="facility_desc">{t("sortFacilityDesc")}</option>
        </select>

        <label className={cn(chip, "border h-9 cursor-pointer select-none", !showCompleted && "opacity-50 grayscale")}>
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} className="hidden" />
          <span className={showCompleted ? "text-primary" : "text-muted-foreground"}>{t("showCompleted")}</span>
        </label>
        <label className={cn(chip, "border h-9 cursor-pointer select-none", !showIncomplete && "opacity-50 grayscale")}>
          <input type="checkbox" checked={showIncomplete} onChange={(e) => setShowIncomplete(e.target.checked)} className="hidden" />
          <span className={showIncomplete ? "text-primary" : "text-muted-foreground"}>{t("showIncomplete")}</span>
        </label>

        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              chip,
              "border border-dashed",
              open ? "border-primary text-primary" : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <ListFilter className="size-3.5" />
            {t("filterStatus")}
          </button>
          {open ? (
            <div className="absolute z-50 mt-1 w-60 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              <ul className="max-h-72 overflow-auto">
                {statuses.map((s) => {
                  const active = selected.has(s);
                  return (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => toggle(s)}
                        className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded border",
                              active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                            )}
                          >
                            {active ? <Check className="size-3" /> : null}
                          </span>
                          {es(s)}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {counts.get(s) ?? 0}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Active status pills */}
        {[...selected].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={cn(chip, "border border-primary/30 bg-primary/10 text-primary")}
          >
            {es(s)}
            <X className="size-3.5 opacity-70" />
          </button>
        ))}

        {selected.size > 0 ? (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ms-1 text-sm font-medium text-primary hover:underline"
          >
            {t("clearFilter")}
          </button>
        ) : null}
      </div>

      {/* Request list */}
      {filteredAndSorted.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {query ? t("noSearchMatch") : selected.size > 0 ? t("noStatusMatch") : t("empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((g) => (
            <Link
              key={g.key}
              href={`${basePath}/${g.key}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40",
                g.cancelled && "border-destructive/40 bg-destructive/5",
                g.isFullyCompleted && "border-green-500/40 bg-green-50 dark:bg-green-500/10"
              )}
            >
              <div>
                <div className={cn("font-medium flex items-center gap-2", g.cancelled && "text-destructive line-through")}>
                  {g.facilityName}
                  <span className="text-xs font-normal text-muted-foreground border rounded-full px-2 py-0.5 bg-background">
                    {eq(g.qualification)}
                  </span>
                  {g.isFullyCompleted ? (
                    <span className="text-xs font-normal text-green-600 border border-green-200 bg-green-100 rounded-full px-2 py-0.5 ml-2 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400">
                      {t("completed")}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  {g.range} · {g.shiftsCount} {t("shiftsCount")} · {g.netLabel} {t("net")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <OrderStatusBadge status={g.status} />
                <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
