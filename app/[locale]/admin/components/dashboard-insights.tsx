"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  BadgeEuro,
  BriefcaseBusiness,
  CalendarClock,
  ChartNoAxesCombined,
  CircleCheckBig,
  Clock3,
  Gauge,
  Landmark,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type DashboardInsightsData = {
  comparisons: { revenue: number; hours: number; shifts: number };
  receivables: { unpaidTotal: number; unpaidCount: number; overdueTotal: number; overdueCount: number; oldestUnpaidDays: number };
  coverage: { requested: number; assigned: number; rate: number };
  urgent: { within24Hours: number; within7Days: number };
  hoursStatus: { confirmed: number; awaiting: number };
  trend: { month: string; paid: number; unpaid: number }[];
  utilization: { rate: number; underTarget: number; overTarget: number };
  expiries: { days30: number; days60: number; days90: number };
  concentration: { top3: number; top5: number };
  acceptance: { accepted: number; declined: number; cancellationRequests: number; rate: number };
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export function DashboardInsights({ data }: { data: DashboardInsightsData }) {
  const t = useTranslations("adminDashboard.insights");
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const trend = data.trend.map((item) => ({
    ...item,
    label: new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" })
      .format(new Date(`${item.month}-01T00:00:00Z`)),
  }));

  return (
    <section className="space-y-4" aria-labelledby="dashboard-insights-title">
      <div>
        <h2 id="dashboard-insights-title" className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <InsightCard icon={ChartNoAxesCombined} title={t("comparison.title")}>
          <ChangeRow label={t("comparison.revenue")} value={data.comparisons.revenue} />
          <ChangeRow label={t("comparison.hours")} value={data.comparisons.hours} />
          <ChangeRow label={t("comparison.shifts")} value={data.comparisons.shifts} />
        </InsightCard>

        <InsightCard icon={BadgeEuro} title={t("receivables.title")} tone={data.receivables.overdueCount > 0 ? "warning" : "default"}>
          <MetricRow label={t("receivables.unpaid")} value={money.format(data.receivables.unpaidTotal)} detail={`${data.receivables.unpaidCount}`} />
          <MetricRow label={t("receivables.overdue")} value={money.format(data.receivables.overdueTotal)} detail={`${data.receivables.overdueCount}`} />
          <MetricRow label={t("receivables.oldest")} value={t("days", { count: data.receivables.oldestUnpaidDays })} />
          <p className="text-[11px] text-muted-foreground">{t("receivables.rule")}</p>
        </InsightCard>

        <InsightCard icon={Gauge} title={t("coverage.title")}>
          <BigMetric value={formatPercent(data.coverage.rate)} label={t("coverage.rate")} />
          <Progress value={data.coverage.rate} />
          <MetricRow label={t("coverage.assigned")} value={`${data.coverage.assigned}`} detail={`/ ${data.coverage.requested}`} />
        </InsightCard>

        <InsightCard icon={AlertTriangle} title={t("urgent.title")} tone={data.urgent.within24Hours > 0 ? "danger" : "default"}>
          <MetricRow label={t("urgent.hours24")} value={`${data.urgent.within24Hours}`} />
          <MetricRow label={t("urgent.days7")} value={`${data.urgent.within7Days}`} />
          <p className="text-[11px] text-muted-foreground">{t("urgent.hint")}</p>
        </InsightCard>

        <InsightCard icon={Clock3} title={t("hoursStatus.title")}>
          <MetricRow label={t("hoursStatus.confirmed")} value={`${number.format(data.hoursStatus.confirmed)} h`} />
          <MetricRow label={t("hoursStatus.awaiting")} value={`${number.format(data.hoursStatus.awaiting)} h`} />
        </InsightCard>

        <InsightCard icon={Users} title={t("utilization.title")}>
          <BigMetric value={formatPercent(data.utilization.rate)} label={t("utilization.rate")} />
          <Progress value={data.utilization.rate} />
          <MetricRow label={t("utilization.under")} value={`${data.utilization.underTarget}`} />
          <MetricRow label={t("utilization.over")} value={`${data.utilization.overTarget}`} />
        </InsightCard>

        <InsightCard icon={CalendarClock} title={t("expiries.title")}>
          <MetricRow label={t("expiries.days30")} value={`${data.expiries.days30}`} />
          <MetricRow label={t("expiries.days60")} value={`${data.expiries.days60}`} />
          <MetricRow label={t("expiries.days90")} value={`${data.expiries.days90}`} />
          <p className="text-[11px] text-muted-foreground">{t("expiries.hint")}</p>
        </InsightCard>

        <InsightCard icon={Landmark} title={t("concentration.title")}>
          <MetricRow label={t("concentration.top3")} value={formatPercent(data.concentration.top3)} />
          <MetricRow label={t("concentration.top5")} value={formatPercent(data.concentration.top5)} />
          <p className="text-[11px] text-muted-foreground">{t("concentration.hint")}</p>
        </InsightCard>

        <InsightCard icon={CircleCheckBig} title={t("acceptance.title")}>
          <BigMetric value={formatPercent(data.acceptance.rate)} label={t("acceptance.rate")} />
          <MetricRow label={t("acceptance.accepted")} value={`${data.acceptance.accepted}`} />
          <MetricRow label={t("acceptance.declined")} value={`${data.acceptance.declined}`} />
          <MetricRow label={t("acceptance.cancellations")} value={`${data.acceptance.cancellationRequests}`} />
        </InsightCard>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <BriefcaseBusiness className="size-4 text-primary" />
            {t("trend.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="paidArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#059669" stopOpacity={0.35} /><stop offset="95%" stopColor="#059669" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="unpaidArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <Tooltip formatter={(value: unknown, name: unknown) => [money.format(Number(value) || 0), name === "paid" ? t("trend.paid") : t("trend.unpaid")]} />
                <Legend formatter={(value) => value === "paid" ? t("trend.paid") : t("trend.unpaid")} />
                <Area type="monotone" dataKey="paid" stroke="#059669" fill="url(#paidArea)" strokeWidth={2} />
                <Area type="monotone" dataKey="unpaid" stroke="#f59e0b" fill="url(#unpaidArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function InsightCard({ icon: Icon, title, children, tone = "default" }: { icon: typeof Gauge; title: string; children: React.ReactNode; tone?: "default" | "warning" | "danger" }) {
  return (
    <Card className={tone === "danger" ? "border-red-500/50" : tone === "warning" ? "border-amber-500/50" : undefined}>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Icon className="size-4 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function MetricRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-semibold tabular-nums">{value} {detail && <span className="font-normal text-muted-foreground">{detail}</span>}</span></div>;
}

function BigMetric({ value, label }: { value: string; label: string }) {
  return <div><div className="text-2xl font-bold tabular-nums">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>;
}

function ChangeRow({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className={positive ? "flex items-center gap-1 font-semibold text-emerald-600" : "flex items-center gap-1 font-semibold text-red-600"}><Icon className="size-3.5" />{value > 0 ? "+" : ""}{formatPercent(value)}</span></div>;
}

function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}
