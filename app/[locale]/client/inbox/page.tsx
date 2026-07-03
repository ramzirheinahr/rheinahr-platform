import { requireRole } from "@/lib/auth";
import { InboxView } from "@/components/inbox/inbox-view";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function ClientInboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireRole(locale as Locale, "client");
  return <InboxView viewer={user} basePath="/client" />;
}
