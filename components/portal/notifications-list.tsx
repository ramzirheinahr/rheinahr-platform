"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notification-actions";
import type { NotificationItem } from "@/components/portal/notifications-bell";

// Full-page notification centre (the "see all" target). Every notification is
// clickable and deep-links to its subject; clicking marks it read.
export function NotificationsList({
  items,
  inboxHref,
}: {
  items: NotificationItem[];
  inboxHref?: string | null;
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

  function hrefFor(n: NotificationItem): string | null {
    if (n.link) return n.link;
    if (n.type === "new_message" && inboxHref) return inboxHref;
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        {unread > 0 ? (
          <button
            type="button"
            onClick={markAll}
            disabled={pending}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {t("markAllRead")}
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border py-16 text-center">
          <Bell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((n) => {
            const inner = (
              <div className="flex items-start gap-3 px-4 py-3">
                {!n.read ? (
                  <span
                    aria-hidden
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive"
                  />
                ) : (
                  <span aria-hidden className="mt-1.5 size-2 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{et(n.type)}</span>
                    <time className="shrink-0 text-xs text-muted-foreground">
                      {n.createdAt.slice(0, 16).replace("T", " ")}
                    </time>
                  </div>
                  {n.content ? (
                    <p className="mt-0.5 break-words text-sm text-muted-foreground">
                      {n.content}
                    </p>
                  ) : null}
                </div>
              </div>
            );
            const href = hrefFor(n);
            return (
              <li key={n.id} className={n.read ? "" : "bg-muted/40"}>
                {href ? (
                  <Link
                    href={href}
                    className="block hover:bg-muted"
                    onClick={() => {
                      if (!n.read) void markNotificationRead(n.id);
                    }}
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
