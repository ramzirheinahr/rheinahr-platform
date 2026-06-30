import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

// Live data behind an auth gate — render per request, never prerender.
export const dynamic = "force-dynamic";

async function getStats() {
  // Wrapped so the dashboard still renders before the DB is provisioned.
  try {
    const [orders, workers, clients, pending] = await Promise.all([
      prisma.order.count(),
      prisma.worker.count(),
      prisma.client.count(),
      prisma.order.count({ where: { status: "pending" } }),
    ]);
    return { orders, workers, clients, pending };
  } catch {
    return null;
  }
}

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;
  const t = await getTranslations("portal");
  const stats = await getStats();

  const cards = [
    { label: t("orders"), value: stats?.orders ?? "—" },
    { label: "Offen / Pending", value: stats?.pending ?? "—" },
    { label: t("workers"), value: stats?.workers ?? "—" },
    { label: t("clients"), value: stats?.clients ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("dashboard")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-3xl font-bold">{card.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
