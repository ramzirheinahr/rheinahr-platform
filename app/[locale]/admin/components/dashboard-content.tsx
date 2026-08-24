import { prisma } from "@/lib/prisma";
import { requestNetTotal, resolveRates, resolveSurcharges, resolveNightWindow, VAT_RATE } from "@/lib/pricing";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Clock, CheckCircle, FileText, Euro } from "lucide-react";
import { ActionItems } from "@/app/[locale]/admin/components/action-items";
import { DashboardCharts } from "@/app/[locale]/admin/components/dashboard-charts";
import { TopLists } from "@/app/[locale]/admin/components/top-lists";
import { DashboardInsights } from "@/app/[locale]/admin/components/dashboard-insights";
import { getEffectiveSollHours } from "@/lib/worker-soll-hours";
import { netShiftHours } from "@/lib/pricing";

async function getStats(monthStr?: string) {
  try {
    const now = new Date();
    let targetYear = now.getFullYear();
    let targetMonth = now.getMonth();
    
    if (monthStr) {
      const parts = monthStr.split('-');
      if (parts.length === 2) {
        targetYear = parseInt(parts[0], 10);
        targetMonth = parseInt(parts[1], 10) - 1;
      }
    }

    const firstDayOfMonth = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0));
    const lastDayOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999));
    const firstDayOfPreviousMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
    const lastDayOfPreviousMonth = new Date(Date.UTC(targetYear, targetMonth, 0, 23, 59, 59, 999));
    const trendStart = new Date(Date.UTC(targetYear, targetMonth - 11, 1));
    const currentTime = new Date();
    const in24Hours = new Date(currentTime.getTime() + 24 * 60 * 60 * 1000);
    const in7Days = new Date(currentTime.getTime() + 7 * 24 * 60 * 60 * 1000);
    const currentDayStart = new Date(Date.UTC(currentTime.getUTCFullYear(), currentTime.getUTCMonth(), currentTime.getUTCDate()));

    const [
      pendingOrders,
      assignedShiftsCount,
      hoursResult,
      allOrdersThisMonth,
      pendingConfirmations,
      pendingLeaves,
      unverifiedDocs,
      pendingContracts,
      ordersByStatus,
      ordersByQual,
      invoicesByStatus,
      allTimeInvoices,
      topClientsData,
      attentionWorkersData,
      previousOrders,
      previousHoursResult,
      unpaidInvoices,
      urgentOrders,
      trendInvoices,
      activeWorkers,
      monthAssignments,
      expiringContracts,
      monthInvoicesByClient,
    ] = await Promise.all([
      // KPIs
      prisma.order.count({ where: { status: "pending", shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } } }),
      prisma.order.count({
        where: {
          status: { in: ["assigned", "accepted", "in_progress", "completed", "confirmed"] },
          shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth },
        },
      }),
      // FIX: Calculate hours based on shift date, not confirmation date
      prisma.serviceConfirmation.aggregate({
        _sum: { hoursWorked: true },
        where: { 
          assignment: {
            order: {
              shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth }
            }
          }
        },
      }),
      // All orders for revenue calculation (exclude cancelled)
      prisma.order.findMany({
        where: { 
          shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth },
          status: { not: "cancelled" }
        },
        include: {
          client: true,
          assignments: { select: { status: true } },
        }
      }),

      // Action Items
      prisma.order.count({ where: { status: "completed", shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } } }),
      prisma.leaveRequest.count({ where: { status: "pending" } }),
      prisma.workerDocument.count({ where: { verified: false } }),
      prisma.clientContract.count({ where: { status: "pending" } }),

      // Charts
      prisma.order.groupBy({
        by: ["status"],
        where: { shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } },
        _count: true,
      }),
      prisma.order.groupBy({
        by: ["requiredQualification"],
        where: { shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } },
        _count: true,
      }),
      prisma.invoice.groupBy({
        by: ["status"],
        where: {
          date: { gte: firstDayOfMonth, lte: lastDayOfMonth },
          status: { in: ["paid", "unpaid"] },
        },
        _sum: { grossAmount: true },
      }),
      // The cumulative invoiced value across every month. Cancelled invoices
      // are deliberately excluded because they are not real receivables/revenue.
      prisma.invoice.aggregate({
        where: { status: { in: ["paid", "unpaid"] } },
        _sum: { grossAmount: true },
      }),

      // Lists
      prisma.order.groupBy({
        by: ["clientId"],
        where: { shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } },
        _count: true,
        orderBy: { _count: { clientId: "desc" } },
        take: 5,
      }),
      prisma.worker.findMany({
        orderBy: { carryoverHours: "asc" },
        take: 5,
        select: { id: true, fullName: true, carryoverHours: true },
        where: { carryoverHours: { not: 0 } },
      }),
      prisma.order.findMany({
        where: {
          shiftDate: { gte: firstDayOfPreviousMonth, lte: lastDayOfPreviousMonth },
          status: { not: "cancelled" },
        },
        include: { client: true },
      }),
      prisma.serviceConfirmation.aggregate({
        _sum: { hoursWorked: true },
        where: {
          assignment: { order: { shiftDate: { gte: firstDayOfPreviousMonth, lte: lastDayOfPreviousMonth } } },
        },
      }),
      prisma.invoice.findMany({
        where: { status: "unpaid" },
        select: {
          id: true,
          date: true,
          grossAmount: true,
          client: { select: { paymentTermsDays: true } },
        },
        orderBy: { date: "asc" },
      }),
      prisma.order.findMany({
        where: {
          shiftDate: { gte: currentDayStart, lte: in7Days },
          status: { notIn: ["cancelled", "completed", "confirmed"] },
        },
        select: {
          shiftDate: true,
          startTime: true,
          quantity: true,
          assignments: { where: { status: { not: "declined" } }, select: { id: true } },
        },
      }),
      prisma.invoice.findMany({
        where: {
          date: { gte: trendStart, lte: lastDayOfMonth },
          status: { in: ["paid", "unpaid"] },
        },
        select: { date: true, status: true, grossAmount: true },
      }),
      prisma.worker.findMany({
        where: { user: { active: true } },
        select: {
          id: true,
          requiredHours: true,
          sollHoursHistory: true,
          assignments: {
            where: {
              status: "confirmed",
              order: { shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } },
            },
            select: {
              bonusHours: true,
              order: { select: { startTime: true, endTime: true, breakMinutes: true } },
              serviceConfirmation: { select: { hoursWorked: true } },
            },
          },
          leaveRequests: {
            select: {
              days: {
                where: {
                  status: "approved",
                  date: { gte: firstDayOfMonth, lte: lastDayOfMonth },
                },
                select: { hours: true },
              },
            },
          },
        },
      }),
      prisma.assignment.findMany({
        where: { order: { shiftDate: { gte: firstDayOfMonth, lte: lastDayOfMonth } } },
        select: {
          status: true,
          cancelRequested: true,
          order: { select: { startTime: true, endTime: true, breakMinutes: true, shiftDate: true } },
          serviceConfirmation: { select: { hoursWorked: true } },
        },
      }),
      prisma.worker.findMany({
        where: {
          user: { active: true },
          employmentEndDate: { not: null, gte: currentTime, lte: new Date(currentTime.getTime() + 90 * 86400000) },
        },
        select: { employmentEndDate: true },
      }),
      prisma.invoice.groupBy({
        by: ["clientId"],
        where: {
          date: { gte: firstDayOfMonth, lte: lastDayOfMonth },
          status: { in: ["paid", "unpaid"] },
        },
        _sum: { grossAmount: true },
      }),
    ]);

    // Format Chart Data
    const fulfillmentData = ordersByStatus.map((o) => ({
      name: o.status,
      value: o._count,
    }));
    const qualificationData = ordersByQual.map((o) => ({
      name: o.requiredQualification,
      value: o._count,
    }));
    
    // Calculate expected total revenue for all orders (gross)
    let totalRevenue = 0;
    for (const order of allOrdersThisMonth) {
      const rates = resolveRates(order.client);
      const surcharges = resolveSurcharges(order.client);
      const nightWindow = resolveNightWindow(order.client);
      const net = requestNetTotal([order], surcharges, rates, nightWindow);
      totalRevenue += net * (1 + VAT_RATE);
    }

    const monthInvoiceTotals = new Map(
      invoicesByStatus.map((invoice) => [invoice.status, Number(invoice._sum.grossAmount || 0)]),
    );
    const invoiceData = [
      { name: "unpaid", value: monthInvoiceTotals.get("unpaid") ?? 0 },
      { name: "paid", value: monthInvoiceTotals.get("paid") ?? 0 },
      { name: "allTime", value: Number(allTimeInvoices._sum.grossAmount || 0) },
    ];

    let previousRevenue = 0;
    for (const order of previousOrders) {
      previousRevenue += requestNetTotal(
        [order],
        resolveSurcharges(order.client),
        resolveRates(order.client),
        resolveNightWindow(order.client),
      ) * (1 + VAT_RATE);
    }
    const previousAssignedShifts = previousOrders.filter((order) =>
      ["assigned", "accepted", "in_progress", "completed", "confirmed"].includes(order.status),
    ).length;
    const percentChange = (current: number, previous: number) =>
      previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / previous) * 100;

    const unpaidTotal = unpaidInvoices.reduce((sum, invoice) => sum + invoice.grossAmount, 0);
    const overdueInvoices = unpaidInvoices.filter((invoice) => {
      const dueAt = new Date(invoice.date);
      dueAt.setUTCDate(dueAt.getUTCDate() + invoice.client.paymentTermsDays);
      return dueAt < currentTime;
    });
    const oldestUnpaidDays = unpaidInvoices[0]
      ? Math.max(0, Math.floor((currentTime.getTime() - unpaidInvoices[0].date.getTime()) / 86400000))
      : 0;

    const requestedHeadcount = allOrdersThisMonth.reduce((sum, order) => sum + order.quantity, 0);
    const assignedHeadcount = allOrdersThisMonth.reduce(
      (sum, order) => sum + Math.min(order.quantity, order.assignments.filter((assignment) => assignment.status !== "declined").length),
      0,
    );

    const urgentOpen = (until: Date) => urgentOrders.reduce((sum, order) => {
      const [hours, minutes] = order.startTime.split(":").map(Number);
      const shiftStart = new Date(order.shiftDate);
      shiftStart.setUTCHours(hours, minutes, 0, 0);
      if (shiftStart < currentTime || shiftStart > until) return sum;
      return sum + Math.max(0, order.quantity - order.assignments.length);
    }, 0);

    const confirmedMonthHours = Number(hoursResult._sum.hoursWorked || 0);
    const awaitingConfirmationHours = monthAssignments.reduce((sum, assignment) => {
      if (assignment.status !== "confirmed" || assignment.serviceConfirmation || assignment.order.shiftDate > currentTime) return sum;
      return sum + netShiftHours(assignment.order.startTime, assignment.order.endTime, assignment.order.breakMinutes);
    }, 0);

    const monthKey = `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`;
    const workerUtilization = activeWorkers.map((worker) => {
      const required = getEffectiveSollHours(monthKey, worker.requiredHours, worker.sollHoursHistory);
      const credited = worker.assignments.reduce((sum, assignment) => {
        const hours = assignment.serviceConfirmation?.hoursWorked != null
          ? Number(assignment.serviceConfirmation.hoursWorked)
          : netShiftHours(assignment.order.startTime, assignment.order.endTime, assignment.order.breakMinutes);
        return sum + hours + assignment.bonusHours;
      }, 0) + worker.leaveRequests.flatMap((request) => request.days).reduce((sum, day) => sum + day.hours, 0);
      return { required, credited };
    });
    const requiredHoursTotal = workerUtilization.reduce((sum, worker) => sum + worker.required, 0);
    const creditedHoursTotal = workerUtilization.reduce((sum, worker) => sum + worker.credited, 0);

    const trendMap = new Map<string, { paid: number; unpaid: number }>();
    for (let offset = 11; offset >= 0; offset--) {
      const date = new Date(Date.UTC(targetYear, targetMonth - offset, 1));
      trendMap.set(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, { paid: 0, unpaid: 0 });
    }
    for (const invoice of trendInvoices) {
      const key = `${invoice.date.getUTCFullYear()}-${String(invoice.date.getUTCMonth() + 1).padStart(2, "0")}`;
      const bucket = trendMap.get(key);
      if (bucket) bucket[invoice.status as "paid" | "unpaid"] += invoice.grossAmount;
    }

    const expiringWithin = (days: number) => expiringContracts.filter((worker) =>
      worker.employmentEndDate && worker.employmentEndDate <= new Date(currentTime.getTime() + days * 86400000),
    ).length;
    const clientRevenue = monthInvoicesByClient.map((row) => Number(row._sum.grossAmount || 0)).sort((a, b) => b - a);
    const totalClientRevenue = clientRevenue.reduce((sum, value) => sum + value, 0);
    const concentration = (count: number) => totalClientRevenue > 0
      ? clientRevenue.slice(0, count).reduce((sum, value) => sum + value, 0) / totalClientRevenue * 100
      : 0;
    const acceptedAssignments = monthAssignments.filter((assignment) => assignment.status === "confirmed").length;
    const declinedAssignments = monthAssignments.filter((assignment) => assignment.status === "declined").length;

    // Format Lists
    const clientIds = topClientsData.map((t) => t.clientId);
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, facilityName: true },
    });
    const topClients = topClientsData.map((t) => ({
      id: t.clientId,
      name: clients.find((c) => c.id === t.clientId)?.facilityName || "Unbekannt",
      orderCount: t._count,
    }));

    const attentionWorkers = attentionWorkersData
      .sort((a, b) => Math.abs(b.carryoverHours) - Math.abs(a.carryoverHours))
      .map((w) => ({
        id: w.id,
        name: w.fullName,
        carryoverHours: w.carryoverHours,
      }));

    return {
      kpis: {
        pendingOrders,
        assignedShiftsCount,
        totalHours: Number(hoursResult._sum.hoursWorked || 0),
        totalRevenue,
      },
      actionItems: {
        pendingConfirmations,
        pendingLeaves,
        unverifiedDocs,
        pendingContracts,
      },
      charts: {
        fulfillmentData,
        qualificationData,
        invoiceData,
      },
      lists: {
        topClients,
        attentionWorkers,
      },
      insights: {
        comparisons: {
          revenue: percentChange(totalRevenue, previousRevenue),
          hours: percentChange(confirmedMonthHours, Number(previousHoursResult._sum.hoursWorked || 0)),
          shifts: percentChange(assignedShiftsCount, previousAssignedShifts),
        },
        receivables: {
          unpaidTotal,
          unpaidCount: unpaidInvoices.length,
          overdueTotal: overdueInvoices.reduce((sum, invoice) => sum + invoice.grossAmount, 0),
          overdueCount: overdueInvoices.length,
          oldestUnpaidDays,
        },
        coverage: {
          requested: requestedHeadcount,
          assigned: assignedHeadcount,
          rate: requestedHeadcount > 0 ? assignedHeadcount / requestedHeadcount * 100 : 0,
        },
        urgent: { within24Hours: urgentOpen(in24Hours), within7Days: urgentOpen(in7Days) },
        hoursStatus: { confirmed: confirmedMonthHours, awaiting: awaitingConfirmationHours },
        trend: [...trendMap].map(([month, values]) => ({ month, ...values })),
        utilization: {
          rate: requiredHoursTotal > 0 ? creditedHoursTotal / requiredHoursTotal * 100 : 0,
          underTarget: workerUtilization.filter((worker) => worker.credited < worker.required * 0.9).length,
          overTarget: workerUtilization.filter((worker) => worker.credited > worker.required * 1.1).length,
        },
        expiries: { days30: expiringWithin(30), days60: expiringWithin(60), days90: expiringWithin(90) },
        concentration: { top3: concentration(3), top5: concentration(5) },
        acceptance: {
          accepted: acceptedAssignments,
          declined: declinedAssignments,
          cancellationRequests: monthAssignments.filter((assignment) => assignment.cancelRequested).length,
          rate: acceptedAssignments + declinedAssignments > 0
            ? acceptedAssignments / (acceptedAssignments + declinedAssignments) * 100
            : 0,
        },
      },
    };
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return null;
  }
}

export async function DashboardContent({ month }: { month: string }) {
  const stats = await getStats(month);

  if (!stats) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Laden der Dashboard-Daten fehlgeschlagen.</p>
      </div>
    );
  }

  return (
    <>
      {/* KPI Widgets */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Offene Anfragen</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.kpis.pendingOrders}</div>
            <p className="text-xs text-muted-foreground">Warten auf Zuweisung</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Besetzte Schichten</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.kpis.assignedShiftsCount}</div>
            <p className="text-xs text-muted-foreground">Im ausgewählten Monat</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Geleistete Stunden</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.kpis.totalHours.toFixed(1)} h</div>
            <p className="text-xs text-muted-foreground">Bestätigt (ausgewählter Monat)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Auftragswert (Gesamt)</CardTitle>
            <Euro className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(stats.kpis.totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground">Erwartet (Brutto) für alle Schichten</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-4">
        {/* Main Charts Area */}
        <div className="md:col-span-4 lg:col-span-3 space-y-4">
          <DashboardCharts 
            fulfillmentData={stats.charts.fulfillmentData}
            qualificationData={stats.charts.qualificationData}
            invoiceData={stats.charts.invoiceData}
          />
          
          <TopLists 
            topClients={stats.lists.topClients}
            attentionWorkers={stats.lists.attentionWorkers}
          />
        </div>

        {/* Action Items Sidebar */}
        <div className="md:col-span-3 lg:col-span-1">
          <ActionItems 
            pendingConfirmations={stats.actionItems.pendingConfirmations}
            pendingLeaves={stats.actionItems.pendingLeaves}
            unverifiedDocs={stats.actionItems.unverifiedDocs}
            pendingContracts={stats.actionItems.pendingContracts}
          />
        </div>
      </div>

      <DashboardInsights data={stats.insights} />
    </>
  );
}
