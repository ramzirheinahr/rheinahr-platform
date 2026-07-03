import { getTranslations } from "next-intl/server";
import type { Prisma, Qualification } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type Column } from "@/components/ui/responsive-table";
import { Plus, Pencil, Clock } from "lucide-react";

type WorkerRow = Awaited<ReturnType<typeof getWorkers>>[number];

export const dynamic = "force-dynamic";

async function getWorkers(qualification?: Qualification) {
  try {
    const where: Prisma.WorkerWhereInput = qualification ? { qualification } : {};
    return await prisma.worker.findMany({
      where,
      orderBy: { createdAt: "desc" },
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

  const columns: Column<WorkerRow>[] = [
    { header: t("fullName"), primary: true, cell: (w) => w.fullName },
    { header: t("email"), cell: (w) => w.user.email },
    // Hide the qualification column when the list is already filtered to one type.
    ...(qualification
      ? []
      : [
          {
            header: t("qualification"),
            cell: (w: WorkerRow) => (
              <Badge variant="secondary">{eq(w.qualification)}</Badge>
            ),
          } as Column<WorkerRow>,
        ]),
    { header: t("contractType"), cell: (w) => ec(w.contractType) },
    { header: t("phone"), cell: (w) => w.phone || c("none") },
    {
      header: c("actions"),
      className: "text-end",
      action: true,
      cell: (w) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/workers/${w.id}/schedule`} />}
          >
            <Clock className="size-4" />
            {t("hoursAction")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`/admin/workers/${w.id}/edit`} />}
          >
            <Pencil className="size-4" />
            {c("edit")}
          </Button>
        </div>
      ),
    },
  ];

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

      <ResponsiveTable
        columns={columns}
        rows={workers}
        getRowKey={(w) => w.id}
        empty={t("empty")}
      />
    </div>
  );
}
