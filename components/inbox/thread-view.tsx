import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { isAgencyRole, loadConversation } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { netShiftHours } from "@/lib/pricing";
import { formatDateDE } from "@/lib/utils";
import { ConversationThread } from "@/components/inbox/conversation-thread";
import type { PortalBasePath } from "@/components/inbox/inbox-view";
import type { SessionUser } from "@/lib/auth";
import { LeaveReviewDialog } from "@/components/inbox/leave-review-dialog";
import {
  TimeChangeReviewDialog,
  type PendingTimeChange,
} from "@/components/inbox/time-change-review-dialog";

// Shared single-thread screen: back link, counterpart header, optional
// context deep-link (order / assignment), then the live thread.
export async function ThreadView({
  viewer,
  basePath,
  conversationId,
}: {
  viewer: SessionUser;
  basePath: PortalBasePath;
  conversationId: string;
}) {
  const detail = await loadConversation(conversationId, viewer);
  if (!detail) notFound();

  const t = await getTranslations("inbox");
  const roles = await getTranslations("roles");
  const agency = isAgencyRole(viewer.role);

  const title = agency
    ? detail.counterpartName || t("agencyTeam")
    : t("agencyTeam");
  const subtitle = [
    detail.context ? t(`context.${detail.context}`) : null,
    detail.subject,
  ]
    .filter(Boolean)
    .join(" · ");

  // Pending client-requested shift-window corrections in this request thread —
  // the office approves/rejects them right here via the review dialog.
  let timeChanges: PendingTimeChange[] = [];
  if (agency && detail.orderRef) {
    const pending = await prisma.serviceConfirmation.findMany({
      where: {
        requestedStart: { not: null },
        requestedEnd: { not: null },
        assignment: { order: { requestGroupId: detail.orderRef } },
      },
      select: {
        assignmentId: true,
        requestedStart: true,
        requestedEnd: true,
        hoursWorked: true,
        clientNotes: true,
        assignment: {
          select: {
            worker: { select: { fullName: true } },
            order: {
              select: {
                shiftDate: true,
                startTime: true,
                endTime: true,
                client: { select: { facilityName: true } },
              },
            },
          },
        },
      },
    });
    timeChanges = pending.map((sc) => ({
      assignmentId: sc.assignmentId,
      workerName: sc.assignment.worker.fullName,
      facilityName: sc.assignment.order.client.facilityName,
      dateLabel: formatDateDE(sc.assignment.order.shiftDate),
      oldStart: sc.assignment.order.startTime,
      oldEnd: sc.assignment.order.endTime,
      newStart: sc.requestedStart!,
      newEnd: sc.requestedEnd!,
      oldHours: sc.hoursWorked === null ? null : Number(sc.hoursWorked),
      newHours: netShiftHours(sc.requestedStart!, sc.requestedEnd!),
      clientNotes: sc.clientNotes,
    }));
  }

  // Where the paperclip icon points, per portal.
  const contextHref = agency
    ? detail.orderRef
      ? `/admin/orders/${detail.orderRef}`
      : null
    : viewer.role === "client"
      ? detail.orderRef
        ? `/client/orders/${detail.orderRef}`
        : null
      : detail.assignmentId
        ? `/worker/assignments/${detail.assignmentId}`
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            render={<Link href={`${basePath}/inbox`} />}
          >
            <ArrowLeft className="size-4" />
            {t("title")}
          </Button>
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">
              {title}
              {agency && detail.counterpartRole ? (
                <span className="ms-2 text-sm font-normal text-muted-foreground">
                  {roles(detail.counterpartRole)}
                </span>
              ) : null}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {timeChanges.length > 0 ? (
            <TimeChangeReviewDialog items={timeChanges} />
          ) : null}
          {contextHref ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              render={<Link href={contextHref} />}
            >
              <ExternalLink className="size-4" />
              {t(detail.context === "assignment" && viewer.role === "worker" ? "openAssignment" : "openOrder")}
            </Button>
          ) : null}
        </div>
        {agency && detail.leaveRequestId ? (
          <LeaveReviewDialog leaveRequestId={detail.leaveRequestId} />
        ) : null}
      </div>

      <ConversationThread conversationId={detail.id} messages={detail.messages} />
    </div>
  );
}
