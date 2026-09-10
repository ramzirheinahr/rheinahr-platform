"use client";

import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertCircle, FileText, ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { qualLabel } from "@/lib/invoicing";

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

  const invoicedCount = shifts.filter((s) => !!s.invoiceId).length;
  const readyCount = shifts.filter((s) => !s.invoiceId && s.isConfirmed).length;
  const awaitingCount = shifts.filter((s) => !s.invoiceId && !s.isConfirmed).length;

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
        if (r.isConfirmed && r.requestGroupId) {
          return (
            <Link
              href={`/admin/orders/${r.requestGroupId}`}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "gap-1 text-xs text-amber-700 border-amber-300 hover:bg-amber-50",
              })}
            >
              Abrechnen
              <ArrowRight className="size-3 ml-1" />
            </Link>
          );
        }
        return <span className="text-slate-300 text-xs">—</span>;
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* KPI Header */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border bg-white shadow-sm flex flex-col">
          <span className="text-xs font-medium text-slate-500">{t("totalShifts")}</span>
          <span className="text-2xl font-bold text-slate-900 mt-1">{shifts.length}</span>
        </div>
        <div className="p-4 rounded-xl border bg-emerald-50/50 border-emerald-200 shadow-sm flex flex-col">
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            {t("invoicedShifts")}
          </span>
          <span className="text-2xl font-bold text-emerald-900 mt-1">{invoicedCount}</span>
        </div>
        <div className="p-4 rounded-xl border bg-amber-50/50 border-amber-200 shadow-sm flex flex-col">
          <span className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            {t("readyShifts")}
          </span>
          <span className="text-2xl font-bold text-amber-900 mt-1">{readyCount}</span>
        </div>
        <div className="p-4 rounded-xl border bg-slate-50 border-slate-200 shadow-sm flex flex-col">
          <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
            <Clock className="size-3.5" />
            {t("awaitingConfirmation")}
          </span>
          <span className="text-2xl font-bold text-slate-800 mt-1">{awaitingCount}</span>
        </div>
      </div>

      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
          <Clock className="size-10 text-slate-300 mb-3" />
          <p className="font-medium text-slate-700">{t("empty")}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <ResponsiveTable
            columns={columns}
            rows={shifts}
            getRowKey={(r) => r.id}
            empty={null}
          />
        </div>
      )}
    </div>
  );
}
