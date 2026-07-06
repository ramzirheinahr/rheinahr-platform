"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Search } from "lucide-react";

export type SelectOption = { value: string; label: string; hint?: string };

// Normalise for "smart" matching: lowercase + strip diacritics so a search for
// "muller" finds "Müller" and "rhein" finds "RheinAhr".
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Token-based fuzzy filter: the query is split into words and an option matches
// when EVERY token appears somewhere in its label/hint. This lets the user type
// partial words in any order without completing them ("mül bon" → "Haus Müller,
// Bonn") — the "smart search that doesn't need whole words" the brief asks for.
export function filterOptions(options: SelectOption[], query: string): SelectOption[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;
  return options.filter((o) => {
    const hay = normalize(`${o.label} ${o.hint ?? ""}`);
    return tokens.every((tok) => hay.includes(tok));
  });
}

// Controlled searchable single-select styled like a native field. Unlike the
// form-oriented Combobox, this reports the chosen value via onChange so it can
// drive local component state (order builder, schedule grid, …).
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
  ariaLabel,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
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

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
      >
        <span className={cn("truncate text-start", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-56 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="relative p-2">
            <Search className="pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 ps-7"
            />
          </div>
          <ul className="max-h-60 overflow-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</li>
            )}
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground",
                      active && "bg-accent/60",
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {active && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
