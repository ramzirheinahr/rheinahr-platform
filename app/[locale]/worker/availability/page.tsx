import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { AvailabilityBuilder } from "@/components/worker/availability-builder";

export const dynamic = "force-dynamic";

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("availability");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const rangeStart = new Date(Date.UTC(year, month - 1, 1));
  const rangeEnd = new Date(Date.UTC(year, month, 1));

  let initialBlocks: { date: string; startTime: string | null; endTime: string | null }[] = [];
  let assignedDates: string[] = [];

  const user = await getCurrentUser();
  if (user) {
    const worker = await prisma.worker
      .findUnique({ where: { userId: user.id }, select: { id: true } })
      .catch(() => null);
    if (worker) {
      const [blocks, asg] = await Promise.all([
        prisma.workerAvailability.findMany({
          where: { workerId: worker.id, status: "unavailable", date: { gte: rangeStart, lt: rangeEnd } },
          select: { date: true, startTime: true, endTime: true },
        }),
        prisma.assignment.findMany({
          where: {
            workerId: worker.id,
            status: { not: "declined" },
            order: { shiftDate: { gte: rangeStart, lt: rangeEnd } },
          },
          select: { order: { select: { shiftDate: true } } },
        }),
      ]);
      initialBlocks = blocks.map((b) => ({
        date: b.date.toISOString().slice(0, 10),
        startTime: b.startTime,
        endTime: b.endTime,
      }));
      assignedDates = asg.map((a) => a.order.shiftDate.toISOString().slice(0, 10));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <AvailabilityBuilder
        year={year}
        month={month}
        initialBlocks={initialBlocks}
        assignedDates={assignedDates}
      />
    </div>
  );
}
