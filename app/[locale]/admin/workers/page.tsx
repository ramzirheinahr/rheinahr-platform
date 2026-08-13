import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { Qualification } from "@/lib/validations";
import { getCurrentUser } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Download, FileSpreadsheet } from "lucide-react";
import { MonthPicker } from "../components/month-picker";
import { WorkersListContent } from "./components/workers-list-content";
import { TableSkeleton } from "@/components/admin/skeletons/table-skeleton";

export const dynamic = "force-dynamic";

// Narrow the query param to a real qualification, or undefined (= show all).
function parseQualification(value?: string): Qualification | undefined {
  return (qualifications as readonly string[]).includes(value ?? "")
    ? (value as Qualification)
    : undefined;
}

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ qualification?: string; month?: string }>;
}) {
  const { qualification: qParam, month: mParam } = await searchParams;
  const qualification = parseQualification(qParam);

  const t = await getTranslations("workers");
  const eq = await getTranslations("enums.qualification");
  const actor = await getCurrentUser();
  
  // When a type is selected the page shows only that type; drop the redundant
  // qualification column and title the page with the type name.
  const heading = qualification ? eq(qualification) : t("title");
  const newHref = qualification
    ? `/admin/workers/new?qualification=${qualification}`
    : "/admin/workers/new";

  const now = new Date();
  const defaultMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const currentMonthStr = mParam && /^\d{4}-\d{2}$/.test(mParam) ? mParam : defaultMonthStr;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <MonthPicker currentMonth={currentMonthStr} />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" render={<a href={`/api/workers/personalliste?month=${currentMonthStr}`} target="_blank" rel="noopener noreferrer" />}>
            <Download className="size-4" />
            Personalliste (PDF)
          </Button>
          <Button variant="outline" className="gap-2" render={<a href={`/api/workers/personalliste-excel?month=${currentMonthStr}`} target="_blank" rel="noopener noreferrer" />}>
            <FileSpreadsheet className="size-4 text-emerald-600" />
            Personalliste (Excel)
          </Button>
          {/* Creating a worker provisions their login account — super_admin only. */}
          {actor?.role === "super_admin" && (
            <Button render={<Link href={newHref} />} className="gap-2">
              <Plus className="size-4" />
              {t("new")}
            </Button>
          )}
        </div>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <WorkersListContent qualification={qualification} currentMonthStr={currentMonthStr} />
      </Suspense>
    </div>
  );
}
