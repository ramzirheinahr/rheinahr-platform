import { prisma } from "@/lib/prisma";
import { NotificationsList } from "@/components/portal/notifications-list";
import type { NotificationItem } from "@/components/portal/notifications-bell";

// Shared "all notifications" page body used by the admin/client/worker routes.
export async function NotificationsPage({
  userId,
  basePath,
}: {
  userId: string;
  basePath: "/admin" | "/client" | "/worker";
}) {
  let items: NotificationItem[] = [];
  try {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        type: true,
        content: true,
        link: true,
        createdAt: true,
        readAt: true,
      },
    });
    items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      link: r.link,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    }));
  } catch {
    items = [];
  }

  return <NotificationsList items={items} inboxHref={`${basePath}/inbox`} />;
}
