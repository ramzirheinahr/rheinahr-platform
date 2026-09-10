"use client";

import { useTranslations } from "next-intl";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Building2, ArrowRight, CheckCircle2, Clock, Receipt, Sparkles } from "lucide-react";
import Link from "next/link";

interface UnbilledClientItem {
  clientId: string;
  facilityName: string;
  shortCode?: string | null;
  internalNumber?: string | null;
  unbilledShiftsCount: number;
  unbilledHoursTotal: number;
  earliestShiftDate: string;
  latestShiftDate: string;
  sampleRequestGroupId?: string;
}

interface UnbilledClientsTabProps {
  unbilledClients: UnbilledClientItem[];
  totalActiveClientsCount: number;
}

export function UnbilledClientsTab({
  unbilledClients,
  totalActiveClientsCount,
}: UnbilledClientsTabProps) {
  const t = useTranslations("invoicing.unbilledClients");

  const columns: Column<UnbilledClientItem>[] = [
    {
      header: t("client"),
      cell: (r) => (
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
            <Building2 className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-slate-900">{r.facilityName}</span>
            <span className="text-xs text-slate-500">
              {r.internalNumber || r.shortCode || r.clientId.slice(0, 8)}
            </span>
          </div>
        </div>
      ),
    },
    {
      header: t("unbilledShifts"),
      cell: (r) => (
        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 font-semibold">
          {r.unbilledShiftsCount} Schichten
        </Badge>
      ),
    },
    {
      header: t("unbilledHours"),
      cell: (r) => (
        <span className="font-semibold text-slate-900">
          {r.unbilledHoursTotal.toFixed(2).replace(".", ",")} Std.
        </span>
      ),
    },
    {
      header: "Zeitraum",
      cell: (r) => (
        <span className="text-xs text-slate-600">
          {r.earliestShiftDate} – {r.latestShiftDate}
        </span>
      ),
    },
    {
      header: "Aktion",
      className: "text-end",
      action: true,
      cell: (r) => (
        <Link
          href={r.sampleRequestGroupId ? `/admin/orders/${r.sampleRequestGroupId}` : `/admin/clients/${r.clientId}/schedule`}
          className={buttonVariants({
            size: "sm",
            className: "bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm",
          })}
        >
          {t("createInvoice")}
          <ArrowRight className="size-3.5" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Alert / KPI Banner */}
      <div className="p-4 rounded-xl border bg-gradient-to-r from-amber-50/80 via-white to-amber-50/40 border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
            <Clock className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{t("title")}</h3>
            <p className="text-sm text-slate-600">
              {t("kpiText", {
                unbilled: unbilledClients.length,
                total: totalActiveClientsCount || unbilledClients.length,
              })}
            </p>
          </div>
        </div>
      </div>

      {unbilledClients.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border rounded-xl border-dashed bg-emerald-50/50 border-emerald-200 text-emerald-700">
          <CheckCircle2 className="size-10 text-emerald-600 mb-3" />
          <p className="font-semibold text-lg">{t("allBilled")}</p>
          <p className="text-xs text-emerald-600/80 mt-1">{t("subtitle")}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <ResponsiveTable
            columns={columns}
            rows={unbilledClients}
            getRowKey={(r) => r.clientId}
            empty={null}
          />
        </div>
      )}
    </div>
  );
}
