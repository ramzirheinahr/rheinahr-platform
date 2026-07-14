import { getTranslations } from "next-intl/server";
import type { Prisma, Qualification } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { WorkersTable, type WorkerTableRow } from "@/components/admin/workers-table";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

async function getWorkers(qualification?: Qualification) {
  try {
    const where: Prisma.WorkerWhereInput = qualification ? { qualification } : {};
    return await prisma.worker.findMany({
      where,
      // Alphabetical by name (case-insensitive) so the roster reads like a phone book.
      orderBy: { fullName: "asc" },
      include: { user: { select: { email: true } } },
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
  const actor = await getCurrentUser();
  const workers = await getWorkers(qualification);
  // When a type is selected the page shows only that type; drop the redundant
  // qualification column and title the page with the type name.
  const heading = qualification ? eq(qualification) : t("title");
  const newHref = qualification
    ? `/admin/workers/new?qualification=${qualification}`
    : "/admin/workers/new";

  const rows: WorkerTableRow[] = workers.map((w) => ({
    id: w.id,
    fullName: w.fullName,
    internalNumber: w.internalNumber ?? "",
    email: w.user.email,
    qualification: w.qualification,
    qualificationLabel: eq(w.qualification),
    contractLabel: ec(w.contractType),
    phone: w.phone || c("none"),
  }));

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
