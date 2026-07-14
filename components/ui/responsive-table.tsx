import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type Column<T> = {
  id?: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Extra classes for the desktop header + cell (e.g. "text-end"). */
  className?: string;
  /** Mobile: render as the card title (no label). */
  primary?: boolean;
  /** Mobile: render right-aligned at the card footer without a label (actions). */
  action?: boolean;
  /** Is this column sortable? Requires 'id' to be set. */
  sortable?: boolean;
};

// Renders a normal table on md+ screens and a stacked-card list on mobile,
// so data tables feel native on phones. Presentational (works in RSC).
export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  empty,
  sortConfig,
  onSort,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  empty: ReactNode;
  sortConfig?: { key: string; direction: "asc" | "desc" } | null;
  onSort?: (key: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  const primary = columns.find((c) => c.primary);
  const actions = columns.filter((c) => c.action);
  const details = columns.filter((c) => !c.primary && !c.action);

  return (
    <>
      {/* Desktop */}
      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c, i) => (
                <TableHead key={c.id || i} className={c.className}>
                  {c.sortable && c.id && onSort ? (
                    <button
                      onClick={() => onSort(c.id!)}
                      className={cn(
                        "flex items-center gap-1 hover:text-foreground transition-colors",
                        sortConfig?.key === c.id ? "text-foreground font-medium" : "text-muted-foreground"
                      )}
                    >
                      {c.header}
                      {sortConfig?.key === c.id ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="size-3.5" />
                        ) : (
                          <ArrowDown className="size-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getRowKey(row)}>
                {columns.map((c, i) => (
                  <TableCell key={c.id || i} className={c.className}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile — one card per row */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={getRowKey(row)} className="rounded-lg border p-4">
            {primary ? (
              <div className="mb-2 font-semibold">{primary.cell(row)}</div>
            ) : null}
            <dl className="space-y-1.5">
              {details.map((c, i) => (
                <div
                  key={c.id || i}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <dt className="shrink-0 text-muted-foreground">{c.header}</dt>
                  <dd className={cn("text-end", c.className)}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions.length ? (
              <div className="mt-3 flex justify-end gap-2 border-t pt-3">
                {actions.map((c, i) => (
                  <span key={c.id || i}>{c.cell(row)}</span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
