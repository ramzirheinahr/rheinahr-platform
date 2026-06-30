import { LocaleSwitcher } from "@/components/locale-switcher";
import { LogoutButton } from "@/components/portal/logout-button";
import { PortalNav, type NavItem } from "@/components/portal/portal-nav";
import {
  NotificationsBell,
  type NotificationItem,
} from "@/components/portal/notifications-bell";
import { Logo } from "@/components/logo";
import { Separator } from "@/components/ui/separator";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Logo className="h-7 w-auto sm:h-8" priority />
          <Separator orientation="vertical" className="hidden h-8 sm:block" />
          <div className="hidden flex-col sm:flex">
            <span className="text-sm font-semibold leading-tight sm:text-base">{title}</span>
            <span className="text-xs text-muted-foreground">{email}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <NotificationsBell items={notifications} />
          <a
            href="/api/me/export"
            download
            aria-label={c("exportData")}
            title={c("exportData")}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <Download className="size-4" />
          </a>
          <LocaleSwitcher />
          <LogoutButton />
        </div>
      </header>

      {/* Mobile navigation (horizontal, scrollable) */}
      <nav className="overflow-x-auto border-b px-3 py-2 md:hidden">
        <PortalNav items={nav} orientation="horizontal" />
      </nav>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-e p-4 md:block">
          <PortalNav items={nav} />
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
