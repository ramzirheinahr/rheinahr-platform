"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "rh-cookie-ack";

// Informational notice — we only set technically necessary cookies (§25 TDDDG),
// so no opt-in is required; this acknowledges and links to the privacy policy.
export function CookieConsent() {
  const t = useTranslations("cookies");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTimeout(() => setVisible(true), 0);
      }
    } catch {
      /* storage unavailable — show nothing */
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {t("message")}{" "}
          <Link href="/datenschutz" className="text-primary underline underline-offset-2">
            {t("learnMore")}
          </Link>
        </p>
        <Button size="sm" onClick={accept} className="shrink-0">
          {t("accept")}
        </Button>
      </div>
    </div>
  );
}
