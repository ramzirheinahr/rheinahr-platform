"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Pencil, Clock, Search } from "lucide-react";

export type ClientTableRow = {
  id: string;
  facilityName: string;
  internalNumber: string;
  facilityTypeLabel: string;
  contactPerson: string;
  email: string;
  shortCode: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(row: ClientTableRow, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = normalize(
    `${row.facilityName} ${row.internalNumber} ${row.facilityTypeLabel} ${row.contactPerson} ${row.email} ${row.shortCode}`,
  );
  return tokens.every((tok) => hay.includes(tok));
}

export function ClientsTable({ rows }: { rows: ClientTableRow[] }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const [query, setQuery] = useState("");

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const filteredAndSorted = useMemo(() => {
    let result = rows.filter((r) => matches(r, query));
    
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        let aVal = a[sortConfig.key as keyof ClientTableRow] ?? "";
        let bVal = b[sortConfig.key as keyof ClientTableRow] ?? "";
        
        // If sorting by internalNumber and both are numeric, we can sort them numerically
        if (sortConfig.key === "internalNumber") {
          const aNum = Number(aVal);
          const bNum = Number(bVal);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortConfig.direction === "asc" ? aNum - bNum : bNum - aNum;
          }
        }
        
        // Fallback to string locale compare
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortConfig.direction === "asc" ? cmp : -cmp;
      });
    }
    
    return result;
  }, [rows, query, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        if (current.direction === "asc") return { key, direction: "desc" };
        return null; // cycle to no-sort
      }
      return { key, direction: "asc" };
    });
  };

  const columns: Column<ClientTableRow>[] = [
    { id: "internalNumber", header: "Int. Nummer", sortable: true, cell: (cl) => cl.internalNumber || "—" },
    { id: "facilityName", header: t("facilityName"), sortable: true, primary: true, cell: (cl) => cl.facilityName },
    {
      header: t("facilityType"),
      cell: (cl) => <Badge variant="secondary">{cl.facilityTypeLabel}</Badge>,
    },
    { header: t("contactPerson"), cell: (cl) => cl.contactPerson },
    { header: t("email"), cell: (cl) => cl.email },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (cl) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/clients/${cl.id}/schedule`} />}
          >
            <Clock className="size-4" />
            {t("hoursAction")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/clients/${cl.id}/edit`} />}
          >
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="ps-9"
          aria-label={t("searchPlaceholder")}
        />
      </div>
      <ResponsiveTable
        columns={columns}
        rows={filteredAndSorted}
        getRowKey={(cl) => cl.id}
        empty={query ? t("noSearchMatch") : t("empty")}
        sortConfig={sortConfig}
        onSort={handleSort}
      />
    </div>
  );
}
