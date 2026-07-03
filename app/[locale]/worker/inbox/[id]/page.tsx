import { requireRole } from "@/lib/auth";
import { ThreadView } from "@/components/inbox/thread-view";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function WorkerThreadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const user = await requireRole(locale as Locale, "worker");
  return <ThreadView viewer={user} basePath="/worker" conversationId={id} />;
}
