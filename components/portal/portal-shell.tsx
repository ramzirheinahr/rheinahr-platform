import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/portal/logout-button";
import { PortalNav, type NavItem } from "@/components/portal/portal-nav";
import {
  NotificationsBell,
  type NotificationItem,
} from "@/components/portal/notifications-bell";
import { Logo } from "@/components/logo";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";

async function getNotifications(userId: string): Promise<NotificationItem[]> {
  try {
    const rows = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, type: true, content: true, createdAt: true, readAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    }));
  } catch {
    return [];
  }
}

// Shared layout shell for the admin/client/worker portals.
export async function PortalShell({
  title,
  email,
  userId,
  nav,
  children,
}: {
  title: string;
  email: string;
  userId: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const notifications = await getNotifications(userId);
  const c = await getTranslations("common");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Logo className="h-8 w-auto" priority />
          <Separator orientation="vertical" className="h-8" />
          <div className="flex flex-col">
            <span className="text-base font-semibold leading-tight">{title}</span>
            <span className="text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NotificationsBell items={notifications} />
          <Button
            variant="ghost"
            size="sm"
            aria-label={c("exportData")}
            title={c("exportData")}
            render={<a href="/api/me/export" download />}
          >
            <Download className="size-4" />
          </Button>
          <LocaleSwitcher />
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-e p-4">
          <PortalNav items={nav} />
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
