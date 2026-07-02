"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, X } from "lucide-react";

export type ComboOption = { value: string; label: string };

// Searchable single/multi select. Selected values are submitted as hidden
// inputs under `name`, so a plain FormData.getAll(name) works on the server.
export function Combobox({
  options,
  name,
  multiple = false,
  defaultValue = [],
  placeholder,
  searchPlaceholder,
  emptyText,
}: {
  options: ComboOption[];
  name: string;
  multiple?: boolean;
  defaultValue?: string[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(defaultValue);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  function toggle(v: string) {
    if (multiple) {
      setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
    } else {
      setSelected([v]);
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={ref} className="relative">
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selected.length === 0 ? (
          <span className="text-muted-foreground">{placeholder}</span>
        ) : multiple ? (
          <span className="flex flex-wrap gap-1">
            {selected.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
              >
                {labelFor(v)}
                <X
                  className="size-3 cursor-pointer opacity-70 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(v);
                  }}
                />
              </span>
            ))}
          </span>
        ) : (
          <span>{labelFor(selected[0])}</span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8"
            />
          </div>
          <ul className="max-h-60 overflow-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</li>
            )}
            {filtered.map((o) => {
              const active = selected.includes(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground",
                      active && "bg-accent/60",
                    )}
                  >
                    {o.label}
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
