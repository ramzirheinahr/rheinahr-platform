import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { loadThreadMessages } from "@/lib/messages";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { MessageThread } from "@/components/messages/message-thread";
import { ArrowLeft } from "lucide-react";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";

export default async function AdminMessagesPage({
  params,
}: {
  params: Promise<{ locale: string; assignmentId: string }>;
}) {
  const { locale, assignmentId } = await params;
  const user = await requireRole(locale as Locale, "admin");
  const tm = await getTranslations("messages");

  const assignment = await prisma.assignment
    .findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        worker: { select: { fullName: true } },
        order: { select: { requestGroupId: true, id: true, client: { select: { facilityName: true } } } },
      },
    })
    .catch(() => null);

  if (!assignment) notFound();

  const messages = await loadThreadMessages(assignmentId, user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href={`/admin/orders/${assignment.order.requestGroupId ?? assignment.order.id}`} />}
        >
          <ArrowLeft className="size-4" />
          {assignment.order.client.facilityName}
        </Button>
        <h1 className="text-2xl font-semibold">
          {tm("title")} — {assignment.worker.fullName}
        </h1>
      </div>

      <MessageThread assignmentId={assignmentId} messages={messages} />
    </div>
  );
}
