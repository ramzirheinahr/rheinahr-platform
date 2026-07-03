import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  isAgencyRole,
  listConversations,
  listRecipients,
  type ConversationListItem,
} from "@/lib/inbox";
import { ComposeButton } from "@/components/inbox/compose-button";
import { Inbox } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

export type PortalBasePath = "/admin" | "/client" | "/worker";

// Shared inbox screen for all three portals: header + compose + thread list.
export async function InboxView({
  viewer,
  basePath,
}: {
  viewer: SessionUser;
  basePath: PortalBasePath;
}) {
  const t = await getTranslations("inbox");
  const roles = await getTranslations("roles");
  const locale = await getLocale();
  const agency = isAgencyRole(viewer.role);

  const [items, recipients] = await Promise.all([
    listConversations(viewer),
    agency ? listRecipients() : Promise.resolve(null),
  ]);

  const timeFmt = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const titleOf = (c: ConversationListItem) =>
    agency ? c.counterpartName || t("agencyTeam") : t("agencyTeam");

  const contextOf = (c: ConversationListItem) =>
    [c.context ? t(`context.${c.context}`) : null, c.subject]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {agency ? t("subtitleAdmin") : t("subtitle")}
          </p>
        </div>
        <ComposeButton
          basePath={basePath}
          recipients={
            recipients
              ? recipients.map((r) => ({
                  id: r.id,
                  name: r.name,
                  role: r.role === "client" ? ("client" as const) : ("worker" as const),
                }))
              : undefined
          }
        />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-14 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {items.map((c) => {
            const context = contextOf(c);
            return (
              <li key={c.id}>
                <Link
                  href={`${basePath}/inbox/${c.id}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-2 size-2 shrink-0 rounded-full",
                      c.unread ? "bg-primary" : "bg-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          c.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {titleOf(c)}
                        {agency && c.counterpartRole ? (
                          <span className="ms-2 text-xs font-normal text-muted-foreground">
                            {roles(c.counterpartRole)}
                          </span>
                        ) : null}
                      </span>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {timeFmt.format(new Date(c.lastAt))}
                      </time>
                    </span>
                    {context ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {context}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "block truncate text-sm",
                        c.unread
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {c.lastMine ? `${t("you")}: ` : ""}
                      {c.lastBody}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
