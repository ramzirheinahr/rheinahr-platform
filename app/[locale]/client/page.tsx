import { setRequestLocale, getTranslations } from "next-intl/server";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function ClientDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("portal");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("dashboard")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t("orders")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {/* Order submission + status tracking lands here (P1, Week 9–10). */}
          —
        </CardContent>
      </Card>
    </div>
  );
}
