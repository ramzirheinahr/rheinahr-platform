import { requireRole } from "@/lib/auth";
import { NotificationsPage } from "@/components/portal/notifications-page";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ClientNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireRole(locale as Locale, "client");
  return <NotificationsPage userId={user.id} basePath="/client" />;
}
