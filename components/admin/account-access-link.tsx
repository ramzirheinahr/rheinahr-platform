"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Link2, KeyRound, Trash2 } from "lucide-react";
import {
  generateAccessLink,
  revokeAccessLink,
} from "@/app/[locale]/admin/account-actions";

// Super-admin control to create/rotate/revoke a client's or worker's passwordless
// access link + PIN. The PIN is shown ONCE right after generation (never stored
// readable), so the admin must copy it now and share it with the user.
export function AccountAccessLink({
  accountId,
  hasLink,
}: {
  accountId: string;
  hasLink: boolean;
}) {
  const t = useTranslations("access");
  const c = useTranslations("common");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [linkActive, setLinkActive] = useState(hasLink);
  // Freshly generated secrets, shown once until the page reloads.
  const [secret, setSecret] = useState<{ url: string; pin: string } | null>(null);

  function buildUrl(token: string): string {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/${locale}/access/${token}`;
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error(c("error"));
    }
  }

  function onGenerate() {
    start(async () => {
      const res = await generateAccessLink(accountId);
      if (res.ok && res.token && res.pin) {
        setSecret({ url: buildUrl(res.token), pin: res.pin });
        setLinkActive(true);
        toast.success(t("generated"));
      } else {
        toast.error(t(res.error === "forbidden" ? "forbidden" : "saveError"));
      }
    });
  }

  function onRevoke() {
    start(async () => {
      const res = await revokeAccessLink(accountId);
      if (res.ok) {
        setSecret(null);
        setLinkActive(false);
        toast.success(t("revoked"));
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Link2 className="size-4" />
          {t("sectionTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("sectionHint")}</p>
      </div>

      {secret ? (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium text-primary">{t("copyNowWarning")}</p>
          <div className="space-y-2">
            <Label>{t("linkLabel")}</Label>
            <div className="flex gap-2">
              <Input readOnly value={secret.url} className="font-mono text-xs" />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("copyLink")}
                onClick={() => copy(secret.url, t("linkCopied"))}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("pinLabel")}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={secret.pin}
                className="max-w-[10rem] font-mono text-lg tracking-[0.4em]"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label={t("copyPin")}
                onClick={() => copy(secret.pin, t("pinCopied"))}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {linkActive ? t("statusActive") : t("statusNone")}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onGenerate} disabled={pending} className="gap-2">
          <KeyRound className="size-4" />
          {linkActive ? t("regenerate") : t("generate")}
        </Button>
        {linkActive && (
          <Button
            type="button"
            variant="outline"
            onClick={onRevoke}
            disabled={pending}
            className="gap-2 text-destructive"
          >
            <Trash2 className="size-4" />
            {t("revoke")}
          </Button>
        )}
      </div>
    </div>
  );
}
