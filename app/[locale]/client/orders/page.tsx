import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { requestNetTotal, resolveSurcharges, type Surcharges } from "@/lib/pricing";
import { formatDateDE } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Plus, ChevronRight } from "lucide-react";
import type { OrderStatus, Qualification } from "@prisma/client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  requestGroupId: string | null;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  quantity: number;
  requiredQualification: Qualification;
  status: OrderStatus;
};

async function getOrders(): Promise<{ rows: Row[]; surcharges: Surcharges }> {
  const empty = { rows: [], surcharges: resolveSurcharges(null) };
  const user = await getCurrentUser();
  if (!user) return empty;
  try {
    const client = await prisma.client.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        surchargeSat: true,
        surchargeSun: true,
        surchargeHoliday: true,
      },
    });
    if (!client) return empty;
    const rows = await prisma.order.findMany({
      where: { clientId: client.id },
      orderBy: [{ createdAt: "desc" }, { shiftDate: "asc" }],
      select: {
        id: true,
        requestGroupId: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        quantity: true,
        requiredQualification: true,
        status: true,
      },
    });
    return { rows, surcharges: resolveSurcharges(client) };
  } catch {
    return empty;
  }
}

function groupOrders(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.requestGroupId ?? r.id;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return Array.from(map.entries()).map(([key, shifts]) => ({
    key,
    shifts: [...shifts].sort(
      (a, b) => a.shiftDate.getTime() - b.shiftDate.getTime(),
    ),
  }));
}

export default async function ClientOrdersPage() {
  const t = await getTranslations("orders");
  const locale = await getLocale();
  const { rows, surcharges } = await getOrders();
  const groups = groupOrders(rows);
  const fmtEur = (n: number) =>
    n.toLocaleString(locale, { style: "currency", currency: "EUR" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button render={<Link href="/client/orders/new" />} className="gap-2">
          <Plus className="size-4" />
          {t("newOrder")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("emptyClient")}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const first = g.shifts[0];
            const last = g.shifts[g.shifts.length - 1];
            const range =
              formatDateDE(first.shiftDate) === formatDateDE(last.shiftDate)
                ? formatDateDE(first.shiftDate)
                : `${formatDateDE(first.shiftDate)} – ${formatDateDE(last.shiftDate)}`;
            const confirmed = g.shifts.filter((s) => s.status === "confirmed").length;
            const total = requestNetTotal(g.shifts, surcharges);
            return (
              <Link
                key={g.key}
                href={`/client/orders/${g.key}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{range}</div>
                  <div className="text-sm text-muted-foreground">
                    {g.shifts.length} {t("shiftsCount")} · {confirmed}/{g.shifts.length} ✓ ·{" "}
                    {fmtEur(total)} {t("net")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <OrderStatusBadge status={first.status} />
                  <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
