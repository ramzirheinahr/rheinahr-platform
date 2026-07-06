"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { ChevronRight, ListFilter, Check, X } from "lucide-react";
import type { OrderStatus } from "@prisma/client";

export type OrderGroupSummary = {
  key: string;
  facilityName: string;
  range: string;
  shiftsCount: number;
  netLabel: string;
  status: OrderStatus;
  cancelled: boolean;
};

// Elegant, chip-based status filter over the request list (inspired by the
// reference facet-filter UI): a "Status" chip opens a popover of toggleable
// statuses; each active status shows as a removable pill, with a "clear" action.
// Filtering happens client-side over the already-loaded requests — no reload.
export function OrdersList({
  groups,
  statuses,
}: {
  groups: OrderGroupSummary[];
  statuses: OrderStatus[];
}) {
  const t = useTranslations("orders");
  const es = useTranslations("enums.orderStatus");
  const [selected, setSelected] = useState<Set<OrderStatus>>(new Set());
  const [open, setOpen] = useState(false);
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

  const filtered = useMemo(() => {
    // Explicit selection wins — show exactly the chosen statuses.
    if (selected.size > 0) return groups.filter((g) => selected.has(g.status));
    // Default view hides finished/cancelled requests to keep the list actionable;
    // the user can still reveal them by selecting those statuses in the filter.
    return groups.filter(
      (g) => !g.cancelled && g.status !== "completed" && g.status !== "cancelled",
    );
  }, [groups, selected]);

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
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {selected.size > 0 ? t("noStatusMatch") : t("empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((g) => (
            <Link
              key={g.key}
              href={`/admin/orders/${g.key}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40",
                g.cancelled && "border-destructive/40 bg-destructive/5",
              )}
            >
              <div>
                <div className={cn("font-medium", g.cancelled && "text-destructive line-through")}>
                  {g.facilityName}
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
