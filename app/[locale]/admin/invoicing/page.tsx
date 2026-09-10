import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InvoicingHub } from "@/components/admin/invoicing/invoicing-hub";
import { format } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export default async function InvoicingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("invoicing");

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const defFrom = `${y}-${pad(m + 1)}-01`;
  const defTo = `${y}-${pad(m + 1)}-${pad(new Date(Date.UTC(y, m + 1, 0)).getUTCDate())}`;
  const fromStr = sp.from && dateRegex.test(sp.from) ? sp.from : defFrom;
  const toStr = sp.to && dateRegex.test(sp.to) ? sp.to : defTo;

  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);

  const q = sp.q?.trim() || "";
  const words = q.split(/\s+/).filter(Boolean);

  const invoiceWhere: any = {
    date: { gte: from, lte: to }
  };

  if (words.length > 0) {
    invoiceWhere.AND = words.map((w) => ({
      OR: [
        { invoiceNumber: { contains: w, mode: "insensitive" } },
        { client: { facilityName: { contains: w, mode: "insensitive" } } }
      ]
    }));
  }

  // 1. Fetch Invoices in range
  const invoices = await prisma.invoice.findMany({
    where: invoiceWhere,
    include: {
      client: true
    },
    orderBy: { date: "desc" }
  });

  // 2. Fetch all assignments in the period (for shift-level billing status verification)
  const assignments = await prisma.assignment.findMany({
    where: {
      order: {
        shiftDate: { gte: from, lte: to },
        ...(words.length > 0
          ? {
              OR: words.map((w) => ({
                client: { facilityName: { contains: w, mode: "insensitive" } },
              })),
            }
          : {}),
      },
      status: { not: "declined" },
    },
    include: {
      order: {
        include: {
          client: true,
        },
      },
      worker: true,
      serviceConfirmation: true,
      invoice: true,
    },
    orderBy: { order: { shiftDate: "desc" } },
  });

  // Transform shifts for shift-level tracker
  const shifts = assignments.map((a) => {
    const hours = a.serviceConfirmation?.hoursWorked
      ? Number(a.serviceConfirmation.hoursWorked)
      : calculateHours(a.order.startTime, a.order.endTime, a.order.breakMinutes || 30);

    return {
      id: a.id,
      shiftDate: a.order.shiftDate.toISOString(),
      startTime: a.order.startTime,
      endTime: a.order.endTime,
      breakMinutes: a.order.breakMinutes || 30,
      facilityName: a.order.client.facilityName,
      clientId: a.order.clientId,
      workerName: a.worker.fullName,
      qualification: a.order.requiredQualification,
      hours,
      isConfirmed: !!a.serviceConfirmation,
      serviceConfirmationId: a.serviceConfirmation?.id,
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoice?.invoiceNumber,
      requestGroupId: a.order.requestGroupId || a.order.id,
    };
  });

  // 3. Find unbilled clients (clients who have at least one unbilled shift in the period)
  const unbilledClientsMap = new Map<
    string,
    {
      clientId: string;
      facilityName: string;
      shortCode?: string | null;
      internalNumber?: string | null;
      unbilledShiftsCount: number;
      unbilledHoursTotal: number;
      earliestShiftDate: Date;
      latestShiftDate: Date;
      sampleRequestGroupId?: string;
    }
  >();

  for (const a of assignments) {
    if (!a.invoiceId) {
      const cId = a.order.clientId;
      const hours = a.serviceConfirmation?.hoursWorked
        ? Number(a.serviceConfirmation.hoursWorked)
        : calculateHours(a.order.startTime, a.order.endTime, a.order.breakMinutes || 30);

      const existing = unbilledClientsMap.get(cId);
      if (!existing) {
        unbilledClientsMap.set(cId, {
          clientId: cId,
          facilityName: a.order.client.facilityName,
          shortCode: a.order.client.shortCode,
          internalNumber: a.order.client.internalNumber,
          unbilledShiftsCount: 1,
          unbilledHoursTotal: hours,
          earliestShiftDate: a.order.shiftDate,
          latestShiftDate: a.order.shiftDate,
          sampleRequestGroupId: a.order.requestGroupId || a.order.id,
        });
      } else {
        existing.unbilledShiftsCount += 1;
        existing.unbilledHoursTotal += hours;
        if (a.order.shiftDate < existing.earliestShiftDate) {
          existing.earliestShiftDate = a.order.shiftDate;
        }
        if (a.order.shiftDate > existing.latestShiftDate) {
          existing.latestShiftDate = a.order.shiftDate;
        }
      }
    }
  }

  const unbilledClients = Array.from(unbilledClientsMap.values()).map((c) => ({
    ...c,
    earliestShiftDate: format(c.earliestShiftDate, "dd.MM.yyyy"),
    latestShiftDate: format(c.latestShiftDate, "dd.MM.yyyy"),
  }));

  // Total active clients with assignments in this period
  const totalActiveClientsCount = new Set(assignments.map((a) => a.order.clientId)).size;

  // 4. Ready to bill shifts (confirmed by client, but not invoiced yet)
  const readyShifts = shifts.filter((s) => !s.invoiceId && s.isConfirmed).map((s) => ({
    id: s.id,
    shiftDate: s.shiftDate,
    startTime: s.startTime,
    endTime: s.endTime,
    facilityName: s.facilityName,
    clientId: s.clientId,
    workerName: s.workerName,
    qualification: s.qualification,
    hours: s.hours,
    confirmedAt: assignments.find((a) => a.id === s.id)?.serviceConfirmation?.confirmedAt?.toISOString() || s.shiftDate,
    requestGroupId: s.requestGroupId,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 p-4 bg-white border rounded-xl shadow-xs">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <Label htmlFor="q" className="text-xs font-semibold text-slate-700">Suche</Label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Rechnung Nr. / Einrichtung..." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from" className="text-xs font-semibold text-slate-700">{t("from")}</Label>
          <Input id="from" name="from" type="date" defaultValue={fromStr} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to" className="text-xs font-semibold text-slate-700">{t("to")}</Label>
          <Input id="to" name="to" type="date" defaultValue={toStr} />
        </div>
        <Button type="submit" variant="default" className="bg-slate-900 hover:bg-slate-800 text-white">
          {t("apply")}
        </Button>
      </form>

      <InvoicingHub
        invoices={invoices}
        shifts={shifts}
        unbilledClients={unbilledClients}
        readyShifts={readyShifts}
        totalActiveClientsCount={totalActiveClientsCount}
      />
    </div>
  );
}

function calculateHours(startTime: string, endTime: string, breakMinutes: number = 30): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (diffMinutes <= 0) diffMinutes += 24 * 60; // overnight
  const netMinutes = Math.max(0, diffMinutes - breakMinutes);
  return Math.round((netMinutes / 60) * 100) / 100;
}
