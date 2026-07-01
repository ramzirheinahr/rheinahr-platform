import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Plus, ChevronRight } from "lucide-react";
import type { OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  requestGroupId: string | null;
  shiftDate: Date;
  status: OrderStatus;
};

async function getOrders(): Promise<Row[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const client = await prisma.client.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!client) return [];
    return await prisma.order.findMany({
      where: { clientId: client.id },
      orderBy: [{ createdAt: "desc" }, { shiftDate: "asc" }],
      select: { id: true, requestGroupId: true, shiftDate: true, status: true },
    });
  } catch {
    return [];
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

const d = (date: Date) => date.toISOString().slice(0, 10);

export default async function ClientOrdersPage() {
  const t = await getTranslations("orders");
  const rows = await getOrders();
  const groups = groupOrders(rows);

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
              d(first.shiftDate) === d(last.shiftDate)
                ? d(first.shiftDate)
                : `${d(first.shiftDate)} – ${d(last.shiftDate)}`;
            const confirmed = g.shifts.filter((s) => s.status === "confirmed").length;
            return (
              <Link
                key={g.key}
                href={`/client/orders/${g.key}`}
                className="flex items-center justify-between gap-3 rounded-lg border p-4 transition-colors hover:border-primary hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{range}</div>
                  <div className="text-sm text-muted-foreground">
                    {g.shifts.length} {t("shiftsCount")} · {confirmed}/{g.shifts.length} ✓
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
