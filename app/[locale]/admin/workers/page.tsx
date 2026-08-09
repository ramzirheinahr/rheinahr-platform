import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import type { Qualification } from "@/lib/validations";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkersTable, type WorkerTableRow } from "@/components/admin/workers-table";
import { Plus } from "lucide-react";
import { getWorkerHoursAccount } from "@/lib/hours-account";

export const dynamic = "force-dynamic";

async function getWorkers(qualification?: Qualification) {
  try {
    const where: Prisma.WorkerWhereInput = qualification ? { qualification } : {};
    return await prisma.worker.findMany({
      where,
      // Sort by internal number by default.
      orderBy: { internalNumber: "asc" },
      include: { user: { select: { id: true, email: true, active: true, receiveEmails: true, _count: { select: { sessions: true } } } } },
    });
  } catch {
    return [];
  }
}

// Narrow the query param to a real qualification, or undefined (= show all).
function parseQualification(value?: string): Qualification | undefined {
  return (qualifications as readonly string[]).includes(value ?? "")
    ? (value as Qualification)
    : undefined;
}

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ qualification?: string }>;
}) {
  const { qualification: qParam } = await searchParams;
  const qualification = parseQualification(qParam);

  const t = await getTranslations("workers");
  const c = await getTranslations("common");
  const eq = await getTranslations("enums.qualification");
  const ec = await getTranslations("enums.contractType");
  const ee = await getTranslations("enums.employmentType");
  const actor = await getCurrentUser();
  const workers = await getWorkers(qualification);
  // When a type is selected the page shows only that type; drop the redundant
  // qualification column and title the page with the type name.
  const heading = qualification ? eq(qualification) : t("title");
  const newHref = qualification
    ? `/admin/workers/new?qualification=${qualification}`
    : "/admin/workers/new";

  const now = new Date();
  const currentMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const rows: WorkerTableRow[] = [];
  const chunkSize = 5;
  for (let i = 0; i < workers.length; i += chunkSize) {
    const chunk = workers.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (w) => {
        let standAlt = 0;
        let zuAbgang = 0;
        let standNeu = 0;
        try {
          const hoursAcc = await getWorkerHoursAccount(w.id, currentMonthStr, currentMonthStr);
          // initialCarryover is the Übertrag before this month
          standAlt = hoursAcc.initialCarryover;
          if (hoursAcc.months.length > 0) {
            const m = hoursAcc.months[hoursAcc.months.length - 1];
            zuAbgang = m.monthBalance;
            standNeu = m.cumulativeBalance;
          } else {
            standNeu = standAlt;
          }
        } catch (err) {
          console.error(`Error calculating hours for worker ${w.id}:`, err);
        }

        return {
          id: w.id,
          fullName: w.fullName,
          internalNumber: w.internalNumber ?? "",
          email: w.user.email,
          userId: w.user.id,
          receiveEmails: w.user.receiveEmails,
          active: w.user.active,
          qualification: w.qualification,
          qualificationLabel: eq(w.qualification),
          contractLabel: ec(w.contractType),
          employmentLabel: ee(w.employmentType),
          phone: w.phone || c("none"),
          activeSessionsCount: w.user._count.sessions,
          standAlt,
          zuAbgang,
          standNeu,
        };
      })
    );
    rows.push(...results);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        {/* Creating a worker provisions their login account — super_admin only. */}
        {actor?.role === "super_admin" && (
          <Button render={<Link href={newHref} />} className="gap-2">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </div>

      <WorkersTable rows={rows} showQualColumn={!qualification} />
    </div>
  );
}
