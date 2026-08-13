import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { MonthPicker } from "./components/month-picker";
import { AccountingExportButton } from "./components/accounting-export-button";
import { DashboardContent } from "./components/dashboard-content";
import { DashboardSkeleton } from "@/components/admin/skeletons/dashboard-skeleton";

export const dynamic = "force-dynamic";

export default async function AdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  await params;
  const { month } = await searchParams;
  
  const now = new Date();
  const currentMonthValue = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const t = await getTranslations("portal");

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard")} (Übersicht)</h1>
        <div className="flex items-center gap-2">
          <AccountingExportButton month={currentMonthValue} />
          <MonthPicker currentMonth={currentMonthValue} />
        </div>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent month={currentMonthValue} />
      </Suspense>
    </div>
  );
}
