"use client";

import { useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Pencil, Clock, Search, Eye, EyeOff, Settings2 } from "lucide-react";
import { ReceiveEmailsToggle } from "./receive-emails-toggle";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type WorkerTableRow = {
  id: string;
  fullName: string;
  internalNumber: string;
  email: string;
  userId: string;
  receiveEmails: boolean;
  active: boolean;
  qualification: string;
  qualificationLabel: string;
  contractLabel: string;
  employmentLabel: string;
  phone: string;
  activeSessionsCount: number;
  standAlt: number;
  zuAbgang: number;
  standNeu: number;
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

  const defaultVisible = [
    "internalNumber",
    "fullName",
    "standAlt",
    "zuAbgang",
    "standNeu",
    "email",
    "phone",
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(defaultVisible);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem("workersTableVisibleColumns");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setVisibleColumns(parsed);
        }
      } catch (e) {}
    }
  }, []);

  const toggleColumn = (colId: string) => {
    const next = visibleColumns.includes(colId)
      ? visibleColumns.filter((id) => id !== colId)
      : [...visibleColumns, colId];
    setVisibleColumns(next);
    localStorage.setItem("workersTableVisibleColumns", JSON.stringify(next));
  };

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

  const columnsList = [
    { id: "internalNumber", label: "Int. Nummer" },
    { id: "fullName", label: t("fullName") },
    { id: "standAlt", label: t("standAlt") },
    { id: "zuAbgang", label: t("zuAbgang") },
    { id: "standNeu", label: t("standNeu") },
    { id: "email", label: t("email") },
    { id: "phone", label: t("phone") },
    { id: "qualification", label: t("qualification") },
    { id: "contractType", label: t("contractType") },
    { id: "employmentType", label: t("employmentType") || "Art der Anstellung" },
    { id: "receiveEmails", label: "E-Mails" },
    { id: "activeSessions", label: t("activeSessionsTitle") || "Sessions" },
  ];

  const allColumnsMap: Record<string, Column<WorkerTableRow>> = {
    internalNumber: { id: "internalNumber", header: "Int. Nummer", sortable: true, cell: (w) => w.internalNumber || "—" },
    fullName: { id: "fullName", header: t("fullName"), sortable: true, primary: true, cell: (w) => w.fullName },
    standAlt: {
      id: "standAlt",
      header: t("standAlt"),
      cell: (w) => {
        const val = w.standAlt;
        return <span className={val < 0 ? "text-red-600 font-semibold" : val > 0 ? "text-emerald-600 font-semibold" : ""}>{val.toFixed(2).replace(".", ",")}</span>;
      }
    },
    zuAbgang: {
      id: "zuAbgang",
      header: t("zuAbgang"),
      cell: (w) => {
        const val = w.zuAbgang;
        return <span className={val < 0 ? "text-red-600 font-semibold" : val > 0 ? "text-emerald-600 font-semibold" : ""}>{val > 0 ? "+" : ""}{val.toFixed(2).replace(".", ",")}</span>;
      }
    },
    standNeu: {
      id: "standNeu",
      header: t("standNeu"),
      cell: (w) => {
        const val = w.standNeu;
        return <span className={val < 0 ? "text-red-600 font-bold" : val > 0 ? "text-emerald-600 font-bold" : "font-bold"}>{val.toFixed(2).replace(".", ",")}</span>;
      }
    },
    email: { id: "email", header: t("email"), cell: (w) => w.email },
    phone: { id: "phone", header: t("phone"), cell: (w) => w.phone },
    qualification: { id: "qualification", header: t("qualification"), cell: (w) => <Badge variant="secondary">{w.qualificationLabel}</Badge> },
    contractType: { id: "contractType", header: t("contractType"), cell: (w) => w.contractLabel },
    employmentType: { id: "employmentType", header: t("employmentType") || "Art der Anstellung", cell: (w) => w.employmentLabel },
    receiveEmails: {
      id: "receiveEmails",
      header: "E-Mails",
      cell: (w) => <ReceiveEmailsToggle userId={w.userId} initialValue={w.receiveEmails} />,
    },
    activeSessions: { 
      id: "activeSessions",
      header: t("activeSessionsTitle") || "Sessions", 
      cell: (w) => (
        <Badge variant={w.activeSessionsCount > 0 ? "default" : "outline"} className={w.activeSessionsCount > 0 ? "bg-green-600 hover:bg-green-700" : "text-muted-foreground"}>
          {w.activeSessionsCount}
        </Badge>
      )
    },
  };

  const finalColumns = columnsList
    .filter((c) => visibleColumns.includes(c.id))
    .map((c) => allColumnsMap[c.id]);

  finalColumns.push({
    id: "actions",
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
  });

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
        <div className="flex items-center gap-2">
          {isMounted && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="gap-2">
                    <Settings2 className="size-4" />
                    Spalten
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-[200px]">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Spalten anzeigen</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {columnsList.map((col) => {
                    // If qualification is hidden by page filter, don't show it in dropdown
                    if (col.id === "qualification" && !showQualColumn) return null;
                    return (
                      <DropdownMenuCheckboxItem
                        key={col.id}
                        checked={visibleColumns.includes(col.id)}
                        onCheckedChange={() => toggleColumn(col.id)}
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            variant="outline"
            onClick={() => setShowInactive((prev) => !prev)}
            className="gap-2"
          >
            {showInactive ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {showInactive ? "Inaktive ausblenden" : "Inaktive anzeigen"}
          </Button>
        </div>
      </div>
      <ResponsiveTable
        columns={finalColumns}
        rows={filteredAndSorted}
        getRowKey={(w) => w.id}
        empty={query ? t("noSearchMatch") : t("empty")}
        sortConfig={sortConfig}
        onSort={handleSort}
      />
    </div>
  );
}
