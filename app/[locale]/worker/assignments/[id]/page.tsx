import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { loadThreadMessages } from "@/lib/messages";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageThread } from "@/components/messages/message-thread";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function WorkerAssignmentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("orders");
  const c = await getTranslations("common");
  const tm = await getTranslations("messages");
  const eq = await getTranslations("enums.qualification");

  const user = await getCurrentUser();
  if (!user) notFound();

  const assignment = await prisma.assignment
    .findUnique({
      where: { id },
      select: {
        id: true,
        worker: { select: { userId: true } },
        order: {
          select: {
            shiftDate: true,
            startTime: true,
            endTime: true,
            requiredQualification: true,
            client: { select: { facilityName: true, address: true } },
          },
        },
      },
    })
    .catch(() => null);

  // Only the assigned worker may view their thread.
  if (!assignment || assignment.worker.userId !== user.id) notFound();

  const messages = await loadThreadMessages(id, user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          render={<Link href="/worker" />}
        >
          <ArrowLeft className="size-4" />
          {c("back")}
        </Button>
        <h1 className="text-2xl font-semibold">
          {assignment.order.client.facilityName}
        </h1>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
          <Field label={t("shiftDate")} value={assignment.order.shiftDate.toISOString().slice(0, 10)} />
          <Field label={t("shiftTime")} value={`${assignment.order.startTime}–${assignment.order.endTime}`} />
          <Field label={t("qualification")} value={eq(assignment.order.requiredQualification)} />
          {assignment.order.client.address ? (
            <Field label={t("facility")} value={assignment.order.client.address} />
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">{tm("title")}</h2>
        <MessageThread assignmentId={id} messages={messages} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
