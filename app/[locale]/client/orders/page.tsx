import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Plus } from "lucide-react";
import type { OrderStatus, Qualification } from "@prisma/client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  requestGroupId: string | null;
  shiftDate: Date;
  startTime: string;
  endTime: string;
  requiredQualification: Qualification;
  quantity: number;
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
      select: {
        id: true,
        requestGroupId: true,
        shiftDate: true,
        startTime: true,
        endTime: true,
        requiredQualification: true,
        quantity: true,
        status: true,
      },
    });
  } catch {
    return [];
  }
}

// Group shifts submitted together (shared requestGroupId); standalone orders
// each form their own group.
function groupOrders(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.requestGroupId ?? `one:${r.id}`;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return Array.from(map.values()).map((shifts) => ({
    shifts: [...shifts].sort(
      (a, b) => a.shiftDate.getTime() - b.shiftDate.getTime(),
    ),
  }));
}

const d = (date: Date) => date.toISOString().slice(0, 10);

export default async function ClientOrdersPage() {
  const t = await getTranslations("orders");
  const eq = await getTranslations("enums.qualification");
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
            const range = d(first.shiftDate) === d(last.shiftDate)
              ? d(first.shiftDate)
              : `${d(first.shiftDate)} – ${d(last.shiftDate)}`;
            const confirmed = g.shifts.filter((s) => s.status === "confirmed").length;
            return (
              <details key={first.id} className="group rounded-lg border" open={g.shifts.length === 1}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-medium">{range}</div>
                    <div className="text-sm text-muted-foreground">
                      {g.shifts.length} {t("shiftsCount")} · {confirmed}/{g.shifts.length} ✓
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <ul className="divide-y border-t">
                  {g.shifts.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <span className="font-medium">{d(s.shiftDate)}</span>
                      <span className="text-muted-foreground">{s.startTime}–{s.endTime}</span>
                      <span>{eq(s.requiredQualification)}</span>
                      <span className="text-muted-foreground">×{s.quantity}</span>
                      <OrderStatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
