"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";

// A discrete header button that opens the install modal or fires the install prompt.
// Hides itself if already running in standalone / installed PWA mode.
export function PwaInstallHeaderButton() {
  const t = useTranslations("pwa");
  const [isStandalone, setIsStandalone] = useState(true);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsStandalone(standalone);
  }, []);

  if (isStandalone) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        // Dispatch custom event to tell PwaInstallPrompt to open instructions or prompt
        window.dispatchEvent(new CustomEvent("open-pwa-install-modal"));
      }}
      className="hidden sm:inline-flex h-8 gap-1.5 px-2.5 text-xs font-medium border-primary/30 text-primary hover:bg-primary/10"
      title={t("installButton")}
    >
      <Smartphone className="size-3.5" />
      <span>{t("installButton")}</span>
    </Button>
  );
}
