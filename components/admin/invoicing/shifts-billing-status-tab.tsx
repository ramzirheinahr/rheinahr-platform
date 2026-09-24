"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckCircle2, Clock, FileText, ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { qualLabel } from "@/lib/invoicing";
import { cn } from "@/lib/utils";
import { generateInvoiceForShift } from "@/app/[locale]/admin/invoicing/actions";
import { toast } from "sonner";

interface ShiftBillingItem {
  id: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  facilityName: string;
  clientId: string;
  workerName: string;
  qualification: string;
  hours: number;
  isConfirmed: boolean;
  serviceConfirmationId?: string;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  requestGroupId?: string;
}

interface ShiftsBillingStatusTabProps {
  shifts: ShiftBillingItem[];
}

export function ShiftsBillingStatusTab({ shifts }: ShiftsBillingStatusTabProps) {
  const t = useTranslations("invoicing.shiftStatus");
  const [filter, setFilter] = useState<"all" | "invoiced" | "ready" | "awaiting">("all");
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const invoicedCount = shifts.filter((s) => !!s.invoiceId).length;
  const readyCount = shifts.filter((s) => !s.invoiceId && s.isConfirmed).length;
  const awaitingCount = shifts.filter((s) => !s.invoiceId && !s.isConfirmed).length;

  const filteredShifts = shifts.filter((s) => {
    if (filter === "invoiced") return !!s.invoiceId;
    if (filter === "ready") return !s.invoiceId && s.isConfirmed;
    if (filter === "awaiting") return !s.invoiceId && !s.isConfirmed;
    return true;
  });

  const handleCreateInvoice = async (shiftId: string) => {
    setGeneratingId(shiftId);
    try {
      const res = await generateInvoiceForShift(shiftId);
      if (res && res.ok) {
        toast.success("Rechnung erfolgreich erstellt!");
      } else {
        toast.error("Fehler beim Erstellen der Rechnung");
      }
    } catch (e: unknown) {
      toast.error((e as Error).message || "Fehler beim Erstellen der Rechnung");
    } finally {
      setGeneratingId(null);
    }
  };

  const columns: Column<ShiftBillingItem>[] = [
    {
      header: t("shiftDate"),
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {format(new Date(r.shiftDate), "dd.MM.yyyy")}
        </span>
      ),
    },
    {
      header: t("times"),
      cell: (r) => (
        <span className="text-slate-600 text-xs">
          {r.startTime} – {r.endTime}
        </span>
      ),
    },
    {
      header: "Kunde",
      className: "min-w-[260px] max-w-[420px]",
      cell: (r) => (
        <span
          className="font-medium text-slate-900 leading-snug whitespace-normal break-words block"
          title={r.facilityName}
        >
          {r.facilityName}
        </span>
      ),
    },
    {
      header: "Mitarbeiter",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-slate-800 text-sm">{r.workerName}</span>
          <span className="text-[11px] text-slate-500">
            {qualLabel[r.qualification as keyof typeof qualLabel] || r.qualification}
          </span>
        </div>
      ),
    },
    {
      header: "Stunden",
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {r.hours.toFixed(2).replace(".", ",")} Std.
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        if (r.invoiceId) {
          return (
            <Badge variant="secondary" className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="size-3" />
              {t("invoiced")} ({r.invoiceNumber})
            </Badge>
          );
        }
        if (r.isConfirmed) {
          return (
            <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-800 border-amber-300">
              <ShieldCheck className="size-3 text-amber-600" />
              {t("ready")}
            </Badge>
          );
        }
        return (
          <Badge variant="outline" className="gap-1 bg-slate-50 text-slate-600 border-slate-200">
            <Clock className="size-3 text-slate-400" />
            {t("awaitingConfirmation")}
          </Badge>
        );
      },
    },
    {
      header: "Aktion",
      className: "text-end",
      action: true,
      cell: (r) => {
        if (r.invoiceId) {
          return (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-slate-600 hover:text-slate-900"
              onClick={() => window.open(`/api/invoices/${r.invoiceId}/pdf`, "_blank")}
            >
              <FileText className="size-3.5 text-emerald-600" />
              PDF
            </Button>
          );
        }
        if (r.isConfirmed) {
          return (
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                className="gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 shadow-xs"
                disabled={generatingId === r.id}
                onClick={() => handleCreateInvoice(r.id)}
              >
                {generatingId === r.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FileText className="size-3" />
                )}
                <span>Rechnung erstellen</span>
              </Button>
              {r.requestGroupId && (
                <Link
                  href={`/admin/orders/${r.requestGroupId}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "text-xs text-slate-600 border-slate-200 hover:bg-slate-50 h-7 px-2",
                  })}
                  title="Bestellung ansehen"
                >
                  <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          );
        }
        return <span className="text-slate-300 text-xs">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Interactive KPI Filter Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all hover:shadow-sm flex flex-col cursor-pointer",
            filter === "all"
              ? "bg-slate-100 border-slate-400 ring-2 ring-slate-400"
              : "bg-white border-slate-200 hover:border-slate-300"
          )}
        >
          <span className="text-xs font-medium text-slate-500">{t("totalShifts")}</span>
          <span className="text-2xl font-bold text-slate-900 mt-1">{shifts.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === "invoiced" ? "all" : "invoiced")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all hover:shadow-sm flex flex-col cursor-pointer",
            filter === "invoiced"
              ? "bg-emerald-100 border-emerald-500 ring-2 ring-emerald-500"
              : "bg-emerald-50/50 border-emerald-200 hover:border-emerald-300"
          )}
        >
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            {t("invoicedShifts")}
          </span>
          <span className="text-2xl font-bold text-emerald-900 mt-1">{invoicedCount}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === "ready" ? "all" : "ready")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all hover:shadow-sm flex flex-col cursor-pointer",
            filter === "ready"
              ? "bg-amber-100 border-amber-500 ring-2 ring-amber-500"
              : "bg-amber-50/50 border-amber-200 hover:border-amber-300"
          )}
        >
          <span className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            {t("readyShifts")}
          </span>
          <span className="text-2xl font-bold text-amber-900 mt-1">{readyCount}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter(filter === "awaiting" ? "all" : "awaiting")}
          className={cn(
            "p-4 rounded-xl border text-left transition-all hover:shadow-sm flex flex-col cursor-pointer",
            filter === "awaiting"
              ? "bg-slate-200 border-slate-500 ring-2 ring-slate-500"
              : "bg-slate-50 border-slate-200 hover:border-slate-300"
          )}
        >
          <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {t("awaitingConfirmation")}
          </span>
          <span className="text-2xl font-bold text-slate-800 mt-1">{awaitingCount}</span>
        </button>
      </div>

      {filteredShifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
          <Clock className="size-10 text-slate-300 mb-3" />
          <p className="font-medium text-slate-700">{t("empty")}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <ResponsiveTable
            columns={columns}
            rows={filteredShifts}
            getRowKey={(r) => r.id}
            empty={null}
          />
        </div>
      )}
    </div>
  );
}

