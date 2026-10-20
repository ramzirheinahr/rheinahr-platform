import { requireRole } from "@/lib/auth";
import type { Locale } from "@/i18n/routing";
import { getDailyNotebook } from "@/lib/daily-notebook";
import { DailyNotebookView } from "@/components/admin/daily-notebook-view";
import { getQualificationCatalog } from "@/lib/qualification-catalog";
import { getCompanyConfig } from "@/lib/config/company";

export const dynamic = "force-dynamic";

export default async function DailyScheduleBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ date?: string; qualification?: string }>;
}) {
  const { locale } = await params;
  await requireRole(locale as Locale, "admin");
  const sp = await searchParams;

  // Determine current date in Europe/Berlin timezone
  const todayBerlin = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const targetDateStr = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
    ? sp.date
    : todayBerlin;

  const qualificationFilter = sp.qualification || "all";

  const [data, qualificationOptions, companyConfig] = await Promise.all([
    getDailyNotebook(targetDateStr, qualificationFilter, locale),
    getQualificationCatalog({ includeArchived: true }),
    getCompanyConfig(),
  ]);

  return (
    <div className="py-2">
      <DailyNotebookView
        data={data}
        qualificationFilter={qualificationFilter}
        qualificationOptions={qualificationOptions}
        companyName={companyConfig.name}
      />
    </div>
  );
}
