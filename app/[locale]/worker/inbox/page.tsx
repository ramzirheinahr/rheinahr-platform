import { requireRole } from "@/lib/auth";
import { InboxView } from "@/components/inbox/inbox-view";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function WorkerInboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireRole(locale as Locale, "worker");
  return <InboxView viewer={user} basePath="/worker" />;
}
