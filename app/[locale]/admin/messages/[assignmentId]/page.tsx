import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { requireRole } from "@/lib/auth";
import { getOrCreateAssignmentConversation } from "@/lib/inbox";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

// Legacy per-assignment chat URL (still linked from the order sheet). The
// thread now lives in the unified inbox — resolve/create its conversation
// and forward there.
export default async function AdminMessagesPage({
  params,
}: {
  params: Promise<{ locale: string; assignmentId: string }>;
}) {
  const { locale, assignmentId } = await params;
  await requireRole(locale as Locale, "admin");

  const conversation = await getOrCreateAssignmentConversation(assignmentId);
  if (!conversation) notFound();

  redirect({ href: `/admin/inbox/${conversation.id}`, locale: locale as Locale });
}
