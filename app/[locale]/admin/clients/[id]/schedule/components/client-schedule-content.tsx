import { getLocale } from "next-intl/server";
import { getClientMonthSchedule } from "@/lib/client-schedule";
import { MonthScheduleTable } from "@/components/client/month-schedule-table";

export async function ClientScheduleContent({
  clientId,
  year,
  month,
}: {
  clientId: string;
  year: number;
  month: number;
}) {
  const locale = await getLocale();
  const { rows, totals } = await getClientMonthSchedule(clientId, year, month);

  return (
    <div className="mt-6">
      <MonthScheduleTable
        rows={rows}
        totals={totals}
        locale={locale}
        year={year}
        month={month}
        showPrices={true}
      />
    </div>
  );
}
