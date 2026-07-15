"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Pencil, Clock, Search, Eye, EyeOff } from "lucide-react";

export type WorkerTableRow = {
  id: string;
  fullName: string;
  internalNumber: string;
  email: string;
  active: boolean;
  qualification: string;
  qualificationLabel: string;
  contractLabel: string;
  phone: string;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(row: WorkerTableRow, query: string): boolean {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = normalize(
    `${row.fullName} ${row.internalNumber} ${row.email} ${row.qualificationLabel} ${row.contractLabel} ${row.phone}`,
  );
  return tokens.every((tok) => hay.includes(tok));
}

export function WorkersTable({
  rows,
  showQualColumn,
}: {
  rows: WorkerTableRow[];
  showQualColumn: boolean;
}) {
  const t = useTranslations("workers");
  const c = useTranslations("common");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const filteredAndSorted = useMemo(() => {
    let result = rows.filter((r) => matches(r, query) && (showInactive || r.active));
    
    if (sortConfig) {
      result = [...result].sort((a, b) => {
        let aVal = a[sortConfig.key as keyof WorkerTableRow] ?? "";
        let bVal = b[sortConfig.key as keyof WorkerTableRow] ?? "";
        
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

  const columns: Column<WorkerTableRow>[] = [
    { id: "internalNumber", header: "Int. Nummer", sortable: true, cell: (w) => w.internalNumber || "—" },
    { id: "fullName", header: t("fullName"), sortable: true, primary: true, cell: (w) => w.fullName },
    { header: t("email"), cell: (w) => w.email },
    ...(showQualColumn
      ? [
          {
            header: t("qualification"),
            cell: (w: WorkerTableRow) => (
              <Badge variant="secondary">{w.qualificationLabel}</Badge>
            ),
          } as Column<WorkerTableRow>,
        ]
      : []),
    { header: t("contractType"), cell: (w) => w.contractLabel },
    { header: t("phone"), cell: (w) => w.phone },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (w) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/workers/${w.id}/schedule`} />}
          >
            <Clock className="size-4" />
            {t("hoursAction")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/workers/${w.id}/edit`} />}
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
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="ps-9"
            aria-label={t("searchPlaceholder")}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setShowInactive((prev) => !prev)}
          className="gap-2"
        >
          {showInactive ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          {showInactive ? "Inaktive ausblenden" : "Inaktive anzeigen"}
        </Button>
      </div>
      <ResponsiveTable
        columns={columns}
        rows={filteredAndSorted}
        getRowKey={(w) => w.id}
        empty={query ? t("noSearchMatch") : t("empty")}
        sortConfig={sortConfig}
        onSort={handleSort}
      />
    </div>
  );
}
