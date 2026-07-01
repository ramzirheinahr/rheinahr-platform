"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Download, Share } from "lucide-react";

// Minimal typing for the non-standard beforeinstallprompt event (Chromium).
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Invites the user to install the app to their home screen so the persistent
// login opens like a native app. Uses the native prompt on Chromium; shows the
// manual "Share → Add to Home Screen" hint on iOS Safari.
export function PwaInstallHint() {
  const t = useTranslations("access");
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari exposes navigator.standalone.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (installed) return null;

  if (deferred) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={async () => {
          await deferred.prompt();
          await deferred.userChoice;
          setDeferred(null);
        }}
      >
        <Download className="size-4" />
        {t("installApp")}
      </Button>
    );
  }

  if (isIos) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Share className="size-3.5 shrink-0" />
        {t("iosInstallHint")}
      </p>
    );
  }

  return null;
}
