"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { filterOptions, type SelectOption } from "@/components/ui/searchable-select";
import { Input } from "@/components/ui/input";
import { ListFilter, Check, X, Search } from "lucide-react";
import type { InvoiceRow } from "@/lib/invoicing";

// Invoice table with a client (facility) facet filter — same chip/popover style
// as the orders list, plus a smart token search over client names (partial words,
// any order) so a long client list stays quick to narrow. Filtering happens
// client-side over the already-loaded rows.
export function InvoicingList({ rows }: { rows: InvoiceRow[] }) {
  const t = useTranslations("invoicing");
  const eq = useTranslations("enums.qualification");
  const ec = useTranslations("confirmations");
  const cc = useTranslations("common");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Distinct client names in the loaded rows, with a per-client row count.
  const { options, counts } = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.facilityName, (m.get(r.facilityName) ?? 0) + 1);
    const opts: SelectOption[] = [...m.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
    return { options: opts, counts: m };
  }, [rows]);

  const visibleOptions = useMemo(() => filterOptions(options, query), [options, query]);

  const filtered = useMemo(
    () =>
      selected.size === 0 ? rows : rows.filter((r) => selected.has(r.facilityName)),
    [rows, selected],
  );
  const totalHours = filtered.reduce((sum, r) => sum + r.hours, 0);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const columns: Column<InvoiceRow>[] = [
    { header: t("date"), primary: true, cell: (r) => r.shiftDate },
    { header: t("facility"), cell: (r) => r.facilityName },
    { header: t("worker"), cell: (r) => r.workerName },
    { header: t("qualification"), cell: (r) => eq(r.qualification) },
    { header: t("hours"), className: "text-end", cell: (r) => r.hours },
    {
      header: t("method"),
      cell: (r) =>
        ec(r.method === "electronic" ? "methodElectronic" : "methodUpload"),
    },
    {
      header: cc("actions"),
      className: "text-end",
      action: true,
      cell: (r) => (
        <a
          href={`/api/confirmations/${r.assignmentId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {ec("pdf")}
        </a>
      ),
    },
  ];

  const chip =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors";

  return (
    <div className="space-y-3">
      {/* Client facet filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              chip,
              "border border-dashed",
              open
                ? "border-primary text-primary"
                : "text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <ListFilter className="size-3.5" />
            {t("filterClient")}
          </button>
          {open ? (
            <div className="absolute z-50 mt-1 w-72 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              <div className="relative p-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchClient")}
                  className="h-8 ps-7"
                />
              </div>
              <ul className="max-h-72 overflow-auto">
                {visibleOptions.length === 0 ? (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
                    {t("empty")}
                  </li>
                ) : (
                  visibleOptions.map((o) => {
                    const active = selected.has(o.value);
                    return (
                      <li key={o.value}>
                        <button
                          type="button"
                          onClick={() => toggle(o.value)}
                          className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded border",
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input",
                              )}
                            >
                              {active ? <Check className="size-3" /> : null}
                            </span>
                            <span className="truncate">{o.label}</span>
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {counts.get(o.value) ?? 0}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Active client pills */}
        {[...selected].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={cn(chip, "border border-primary/30 bg-primary/10 text-primary")}
          >
            {name}
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

      <ResponsiveTable
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.assignmentId}
        empty={selected.size > 0 ? t("noClientMatch") : t("empty")}
      />

      {filtered.length > 0 ? (
        <div className="flex justify-end gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm font-semibold">
          <span>{t("totalHours")}:</span>
          <span>{totalHours}</span>
        </div>
      ) : null}
    </div>
  );
}
