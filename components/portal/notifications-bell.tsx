"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notification-actions";
import type { NotificationType } from "@prisma/client";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  content: string;
  link: string | null;
  createdAt: string; // ISO
  read: boolean;
};

export function NotificationsBell({
  items,
  inboxHref,
  allHref,
}: {
  items: NotificationItem[];
  // Portal inbox path — legacy fallback for "new message" notifications that
  // predate stored deep links.
  inboxHref?: string | null;
  // Portal "all notifications" page.
  allHref: string;
}) {
  const t = useTranslations("notifications");
  const et = useTranslations("enums.notificationType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unread = items.filter((i) => !i.read).length;

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  // Best target for a notification: its stored deep link, else the inbox for
  // legacy message notifications.
  function hrefFor(n: NotificationItem): string | null {
    if (n.link) return n.link;
    if (n.type === "new_message" && inboxHref) return inboxHref;
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("title")}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "relative")}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("title")}</span>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("markAllRead")}
            </button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const inner = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{et(n.type)}</span>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {n.createdAt.slice(0, 16).replace("T", " ")}
                    </time>
                  </div>
                  {n.content ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.content}</p>
                  ) : null}
                </>
              );
              const href = hrefFor(n);
              return (
                <li
                  key={n.id}
                  className={`border-b text-sm last:border-0 ${
                    n.read ? "" : "bg-muted/40"
                  }`}
                >
                  {href ? (
                    <Link
                      href={href}
                      className="block px-3 py-2 hover:bg-muted"
                      onClick={() => {
                        // Mark read without blocking navigation.
                        if (!n.read) void markNotificationRead(n.id);
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="px-3 py-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t">
          <Link
            href={allHref}
            className="block px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t("seeAll")}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
