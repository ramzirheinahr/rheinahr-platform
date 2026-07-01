import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { germanHolidays } from "@/lib/holidays";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignmentActions } from "@/components/worker/assignment-actions";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";

export const dynamic = "force-dynamic";

async function getAssignments(year: number, month: number) {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const worker = await prisma.worker.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!worker) return [];
    return await prisma.assignment.findMany({
      where: {
        workerId: worker.id,
        order: {
          shiftDate: {
            gte: new Date(Date.UTC(year, month - 1, 1)),
            lt: new Date(Date.UTC(year, month, 1)),
          },
        },
      },
      orderBy: { order: { shiftDate: "asc" } },
      include: {
        order: {
          select: {
            shiftDate: true,
            startTime: true,
            endTime: true,
            notes: true,
            client: { select: { facilityName: true, address: true } },
          },
        },
      },
    });
  } catch {
    return [];
  }
}

export default async function WorkerAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const oq = await getTranslations("orderRequest");
  const eas = await getTranslations("enums.assignmentStatus");
  const av = await getTranslations("availability");

  const now = new Date();
  let year = Number(sp.year) || now.getUTCFullYear();
  let month = Number(sp.month) || now.getUTCMonth() + 1;
  if (month < 1 || month > 12) month = now.getUTCMonth() + 1;
  if (year < 2020 || year > 2100) year = now.getUTCFullYear();

  const assignments = await getAssignments(year, month);
  const holidays = germanHolidays(year);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("myAssignments")}</h1>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-1" render={<Link href={`/worker/assignments?year=${prev.y}&month=${prev.m}`} />}>
          <ChevronLeft className="size-4" />
          {av("prevMonth")}
        </Button>
        <span className="font-semibold">{monthLabel}</span>
        <Button variant="ghost" size="sm" className="gap-1" render={<Link href={`/worker/assignments?year=${next.y}&month=${next.m}`} />}>
          {av("nextMonth")}
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {assignments.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("noAssignments")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shiftDate")}</TableHead>
                <TableHead>{t("facility")}</TableHead>
                <TableHead>{t("shiftTime")}</TableHead>
                <TableHead>{oq("ward")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead className="text-end">{c("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => {
                const dateStr = a.order.shiftDate.toISOString().slice(0, 10);
                const dow = a.order.shiftDate.getUTCDay();
                const weekendOrHoliday = dow === 0 || dow === 6 || holidays.has(dateStr);
                return (
                  <TableRow key={a.id} className={cn(weekendOrHoliday && "bg-rose-500/10")}>
                    <TableCell className="font-medium">{dateStr}</TableCell>
                    <TableCell>{a.order.client.facilityName}</TableCell>
                    <TableCell>{a.order.startTime}–{a.order.endTime}</TableCell>
                    <TableCell>{a.order.notes || c("none")}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === "confirmed" ? "default" : a.status === "declined" ? "outline" : "secondary"}>
                        {eas(a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {a.status === "pending" ? <AssignmentActions assignmentId={a.id} /> : null}
                        <Button variant="ghost" size="sm" render={<Link href={`/worker/assignments/${a.id}`} />}>
                          <MessageSquare className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
