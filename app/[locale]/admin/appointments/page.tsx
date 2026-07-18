import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import type { Locale } from "@/i18n/routing";
import { prisma } from "@/lib/prisma";
import { AppointmentsCalendar } from "@/components/admin/appointments-calendar";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const admin = await requireRole(locale as Locale, "admin");
  const t = await getTranslations("appointments");

  const appointments = await prisma.appointment.findMany({
    where: { managerId: admin.id },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      
      <AppointmentsCalendar appointments={appointments} />
    </div>
  );
}
