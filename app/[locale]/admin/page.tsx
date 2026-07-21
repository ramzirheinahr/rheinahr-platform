import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, FileText, CheckCircle, Clock, Euro } from "lucide-react";
import { ActionItems } from "./components/action-items";
import { DashboardCharts } from "./components/dashboard-charts";
import { TopLists } from "./components/top-lists";
import { MonthPicker } from "./components/month-picker";

export const dynamic = "force-dynamic";

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

    const firstDayOfMonth = new Date(targetYear, targetMonth, 1);
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0);

    const [
      pendingOrders,
      assignedShiftsCount,
      hoursResult,
      totalActiveWorkers,
      pendingConfirmations,
      pendingLeaves,
      unverifiedDocs,
      pendingContracts,
      ordersByStatus,
      ordersByQual,
      invoicesByStatus,
      topClientsData,
      attentionWorkersData,
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
      prisma.worker.count({ where: { user: { active: true } } }), // Still overall active workers

      // Action Items (Overall system state, not necessarily month bound, except confirmations)
      prisma.order.count({ where: { status: "completed" } }),
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
        where: { date: { gte: firstDayOfMonth, lte: lastDayOfMonth } },
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
        orderBy: { carryoverHours: "asc" }, // largest deficit (negative) or surplus (positive)
        take: 5,
        select: { id: true, fullName: true, carryoverHours: true },
        where: { carryoverHours: { not: 0 } },
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
    
    let totalRevenue = 0;
    const invoiceData = invoicesByStatus.map((i) => {
      const val = Number(i._sum.grossAmount || 0);
      totalRevenue += val;
      return {
        name: i.status,
        value: val,
      };
    });

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
    };
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return null;
  }
}

export default async function AdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  await params;
  const { month } = await searchParams;
  
  const now = new Date();
  const currentMonthValue = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const t = await getTranslations("portal");
  const stats = await getStats(currentMonthValue);

  if (!stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("dashboard")}</h1>
        <p className="text-muted-foreground">Laden der Dashboard-Daten fehlgeschlagen.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard")} (Übersicht)</h1>
        <MonthPicker currentMonth={currentMonthValue} />
      </div>

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
            <CardTitle className="text-sm font-medium">Umsatz (Rechnungen)</CardTitle>
            <Euro className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(stats.kpis.totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground">Bruttoumsatz im Monat</p>
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
    </div>
  );
}
