"use client";

import { useTranslations } from "next-intl";
import { format } from "@/lib/date-utils";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ShieldCheck, ArrowRight, FileCheck, Building2 } from "lucide-react";
import Link from "next/link";
import { qualLabel } from "@/lib/invoicing";

interface ReadyShiftItem {
  id: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  facilityName: string;
  clientId: string;
  workerName: string;
  qualification: string;
  hours: number;
  confirmedAt: string;
  requestGroupId?: string;
}

interface ReadyToBillTabProps {
  shifts: ReadyShiftItem[];
}

export function ReadyToBillTab({ shifts }: ReadyToBillTabProps) {
  const t = useTranslations("invoicing");

  const columns: Column<ReadyShiftItem>[] = [
    {
      header: "Schichtdatum",
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {format(new Date(r.shiftDate), "dd.MM.yyyy")}
        </span>
      ),
    },
    {
      header: "Kunde / Einrichtung",
      cell: (r) => (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-slate-400 shrink-0" />
          <span className="font-medium text-slate-900">{r.facilityName}</span>
        </div>
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
      header: "Geleistete Stunden",
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {r.hours.toFixed(2).replace(".", ",")} Std.
        </span>
      ),
    },
    {
      header: "Bestätigt am",
      cell: (r) => (
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <FileCheck className="size-3.5 text-emerald-600" />
          <span>{format(new Date(r.confirmedAt), "dd.MM.yyyy HH:mm")}</span>
        </div>
      ),
    },
    {
      header: "Aktion",
      className: "text-end",
      action: true,
      cell: (r) => (
        <Link
          href={r.requestGroupId ? `/admin/orders/${r.requestGroupId}` : `/admin/clients/${r.clientId}/schedule`}
          className={buttonVariants({
            size: "sm",
            className: "bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm text-xs",
          })}
        >
          Rechnung erstellen
          <ArrowRight className="size-3.5" />
        </Link>
      ),
    },
  ];

  if (shifts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-slate-50 text-slate-500">
        <ShieldCheck className="size-10 text-slate-300 mb-3" />
        <p className="font-medium text-slate-700">Keine unberechneten, bestätigten Schichten vorhanden.</p>
        <p className="text-xs text-slate-400 mt-1">
          Sobald ein Kunde einen Leistungsnachweis bestätigt hat, erscheint die Schicht hier zur direkten Abrechnung.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl border bg-emerald-50/60 border-emerald-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Abrechnungsbereite Schichten</h3>
            <p className="text-sm text-slate-600">
              {shifts.length} Schicht(en) wurden vom Kunden bereits digital oder per Nachweis bestätigt und können abgerechnet werden.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <ResponsiveTable
          columns={columns}
          rows={shifts}
          getRowKey={(r) => r.id}
          empty={null}
        />
      </div>
    </div>
  );
}
