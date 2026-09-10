"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  subLabel?: string;
  searchTerms?: string;
};

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
    const hay = normalize(`${o.label} ${o.hint ?? ""} ${o.subLabel ?? ""} ${o.searchTerms ?? ""}`);
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
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
  ariaLabel,
}: {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    placeAbove: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    placeAbove: false,
  });

  const updateCoords = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const placeAbove =
        rect.bottom + 270 > window.innerHeight && rect.top > 270;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setCoords({
        top: placeAbove ? rect.top - 4 : rect.bottom + 4,
        left,
        width,
        placeAbove,
      });
    }
  };

  useEffect(() => {
    if (open) {
      updateCoords();
      const onScrollOrResize = () => updateCoords();
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize);
      return () => {
        window.removeEventListener("scroll", onScrollOrResize, true);
        window.removeEventListener("resize", onScrollOrResize);
      };
    }
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  function choose(v: string) {
    if (onChange) onChange(v);
    if (onValueChange) onValueChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={cn("relative w-full", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
      >
        <span className={cn("truncate text-start", !selected && "text-muted-foreground")}>
          {selected ? (
            <span>
              {selected.label}{" "}
              {(selected.hint || selected.subLabel) && (
                <span className="text-muted-foreground text-xs font-normal">
                  ({selected.hint || selected.subLabel})
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              transform: coords.placeAbove ? "translateY(-100%)" : undefined,
              zIndex: 99999,
            }}
            className="rounded-xl border border-border/80 bg-popover/95 backdrop-blur-md text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95"
          >
            <div className="relative p-2 border-b border-border/50">
              <Search className="pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 ps-7 pe-7"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <ul className="max-h-60 overflow-auto p-1 divide-y divide-border/20">
              {filtered.length === 0 && (
                <li className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {emptyText || "Keine Ergebnisse"}
                </li>
              )}
              {filtered.map((o) => {
                const active = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => choose(o.value)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-start text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                        active && "bg-accent/70 font-medium text-accent-foreground",
                      )}
                    >
                      <div className="flex flex-col truncate">
                        <span className="truncate">{o.label}</span>
                        {(o.hint || o.subLabel) && (
                          <span className="text-xs text-muted-foreground truncate">
                            {o.hint || o.subLabel}
                          </span>
                        )}
                      </div>
                      {active && <Check className="size-4 shrink-0 text-emerald-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </div>
  );
}
