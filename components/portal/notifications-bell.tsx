"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { markAllNotificationsRead } from "@/lib/notification-actions";
import type { NotificationType } from "@prisma/client";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  content: string;
  createdAt: string; // ISO
  read: boolean;
};

export function NotificationsBell({ items }: { items: NotificationItem[] }) {
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="relative" aria-label={t("title")}>
            <Bell className="size-4" />
            {unread > 0 ? (
              <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Button>
        }
      />
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
            {items.map((n) => (
              <li
                key={n.id}
                className={`border-b px-3 py-2 text-sm last:border-0 ${
                  n.read ? "" : "bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{et(n.type)}</span>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {n.createdAt.slice(0, 16).replace("T", " ")}
                  </time>
                </div>
                {n.content ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{n.content}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
