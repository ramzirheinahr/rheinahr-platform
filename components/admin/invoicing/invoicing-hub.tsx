"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvoicingList } from "@/components/admin/invoicing-list";
import { SentInvoicesTab } from "./sent-invoices-tab";
import { ShiftsBillingStatusTab } from "./shifts-billing-status-tab";
import { UnbilledClientsTab } from "./unbilled-clients-tab";
import { ReadyToBillTab } from "./ready-to-bill-tab";
import { FileText, Mail, BarChart3, Users, ShieldCheck } from "lucide-react";

interface InvoicingHubProps {
  invoices: any[];
  shifts: any[];
  unbilledClients: any[];
  readyShifts: any[];
  totalActiveClientsCount: number;
}

export function InvoicingHub({
  invoices,
  shifts,
  unbilledClients,
  readyShifts,
  totalActiveClientsCount,
}: InvoicingHubProps) {
  const t = useTranslations("invoicing");
  const [activeTab, setActiveTab] = useState("invoices");

  const sentCount = invoices.filter((i) => !!i.snapshotData?.emailSent?.sentAt).length;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <div className="overflow-x-auto pb-1">
        <TabsList className="h-auto p-1 bg-slate-100/90 border border-slate-200/80 rounded-xl inline-flex flex-nowrap min-w-full sm:min-w-0">
          <TabsTrigger
            value="invoices"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm whitespace-nowrap"
          >
            <FileText className="size-4" />
            <span>{t("tabs.invoices")}</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-slate-200/80 text-slate-700 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800">
              {invoices.length}
            </span>
          </TabsTrigger>

          <TabsTrigger
            value="sentEmails"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm whitespace-nowrap"
          >
            <Mail className="size-4" />
            <span>{t("tabs.sentEmails")}</span>
            {sentCount > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800">
                {sentCount}
              </span>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="shiftStatus"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm whitespace-nowrap"
          >
            <BarChart3 className="size-4" />
            <span>{t("tabs.shiftStatus")}</span>
            <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-slate-200/80 text-slate-700">
              {shifts.length}
            </span>
          </TabsTrigger>

          <TabsTrigger
            value="unbilledClients"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-amber-800 data-[state=active]:shadow-sm whitespace-nowrap"
          >
            <Users className="size-4" />
            <span>{t("tabs.unbilledClients")}</span>
            {unbilledClients.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-900 font-semibold">
                {unbilledClients.length}
              </span>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="readyToBill"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-emerald-800 data-[state=active]:shadow-sm whitespace-nowrap"
          >
            <ShieldCheck className="size-4" />
            <span>{t("tabs.readyToBill")}</span>
            {readyShifts.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-900 font-semibold">
                {readyShifts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="invoices" className="m-0 focus-visible:outline-none">
        <InvoicingList invoices={invoices} />
      </TabsContent>

      <TabsContent value="sentEmails" className="m-0 focus-visible:outline-none">
        <SentInvoicesTab invoices={invoices} />
      </TabsContent>

      <TabsContent value="shiftStatus" className="m-0 focus-visible:outline-none">
        <ShiftsBillingStatusTab shifts={shifts} />
      </TabsContent>

      <TabsContent value="unbilledClients" className="m-0 focus-visible:outline-none">
        <UnbilledClientsTab
          unbilledClients={unbilledClients}
          totalActiveClientsCount={totalActiveClientsCount}
        />
      </TabsContent>

      <TabsContent value="readyToBill" className="m-0 focus-visible:outline-none">
        <ReadyToBillTab shifts={readyShifts} />
      </TabsContent>
    </Tabs>
  );
}
