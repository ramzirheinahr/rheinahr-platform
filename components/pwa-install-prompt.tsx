"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Download,
  Share,
  Smartphone,
  X,
  HelpCircle,
  MoreVertical,
  PlusSquare,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "rheinahr_pwa_prompt_dismissed_until";
// Hide for 14 days when dismissed by the user
const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function PwaInstallPrompt() {
  const t = useTranslations("pwa");

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"ios" | "android">("android");

  useEffect(() => {
    // 1. Check if already installed / in standalone mode
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (standalone) {
      setIsStandalone(true);
      return;
    }
    setIsStandalone(false);

    // 2. Check dismissal storage
    try {
      const dismissedUntil = localStorage.getItem(DISMISS_KEY);
      if (dismissedUntil && Number(dismissedUntil) > Date.now()) {
        setIsDismissed(true);
      } else {
        setIsDismissed(false);
      }
    } catch {
      setIsDismissed(false);
    }

    // 3. Detect device & OS
    const ua = window.navigator.userAgent.toLowerCase();
    const iosDetected = /iphone|ipad|ipod/.test(ua);
    const androidDetected = /android/.test(ua);
    const mobileDetected = iosDetected || androidDetected || /mobile|tablet/.test(ua);

    setIsIos(iosDetected);
    setIsAndroid(androidDetected);
    setIsMobile(mobileDetected);
    if (iosDetected) {
      setActiveTab("ios");
    } else {
      setActiveTab("android");
    }

    // 4. Capture native Chromium install prompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    const handleOpenModal = () => {
      setInstructionsOpen(true);
    };
    window.addEventListener("open-pwa-install-modal", handleOpenModal);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("open-pwa-install-modal", handleOpenModal);
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch {}
    setIsDismissed(true);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setIsStandalone(true);
      }
      setDeferredPrompt(null);
    } else {
      // If iOS or browser doesn't expose native trigger, show visual guide
      setInstructionsOpen(true);
    }
  };

  // If already standalone or user dismissed, don't show the banner
  if (isStandalone || isDismissed) {
    return (
      <InstallInstructionsModal
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    );
  }

  // Only show the banner proactively on mobile devices or if deferred prompt is ready
  if (!isMobile && !deferredPrompt) {
    return null;
  }

  return (
    <>
      {/* Floating Bottom Card Banner on Mobile */}
      <aside
        aria-label={t("bannerTitle")}
        className="fixed bottom-4 inset-x-3 z-50 mx-auto max-w-lg rounded-2xl border border-primary/20 bg-background/95 p-4 shadow-xl backdrop-blur-md transition-all duration-300 dark:border-primary/30"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Smartphone className="size-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {t("bannerTitle")}
              </h2>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t("dismiss")}
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
              {t("bannerSubtitle")}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {deferredPrompt ? (
                <Button
                  size="sm"
                  onClick={handleInstallClick}
                  className="h-8 gap-1.5 px-3 text-xs font-medium shadow-xs"
                >
                  <Download className="size-3.5" />
                  {t("installButton")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setInstructionsOpen(true)}
                  className="h-8 gap-1.5 px-3 text-xs font-medium shadow-xs"
                >
                  <Smartphone className="size-3.5" />
                  {t("howToInstall")}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInstructionsOpen(true)}
                className="h-8 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="size-3.5" />
                {t("howToInstall")}
              </Button>

              <button
                type="button"
                onClick={handleDismiss}
                className="ms-auto text-xs text-muted-foreground hover:underline"
              >
                {t("dismiss")}
              </button>
            </div>
          </div>
        </div>
      </aside>

      <InstallInstructionsModal
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </>
  );
}

function InstallInstructionsModal({
  open,
  onOpenChange,
  activeTab,
  setActiveTab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: "ios" | "android";
  setActiveTab: (tab: "ios" | "android") => void;
}) {
  const t = useTranslations("pwa");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Smartphone className="size-5 text-primary" />
            {t("instructionsTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("instructionsSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {/* Tab switchers: iOS vs Android */}
        <div className="flex rounded-lg bg-muted p-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab("android")}
            className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
              activeTab === "android"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("androidTab")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("ios")}
            className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
              activeTab === "ios"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("iosTab")}
          </button>
        </div>

        {/* Content based on Tab */}
        <div className="mt-2 space-y-3">
          {activeTab === "ios" ? (
            <div className="space-y-3 text-xs text-foreground">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  1
                </div>
                <div className="flex-1">
                  <span>{t("iosStep1")} </span>
                  <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    <Share className="size-3" /> Teilen
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  2
                </div>
                <div className="flex-1">
                  <span>{t("iosStep2")} </span>
                  <span className="font-semibold text-primary underline underline-offset-2">
                    {t("iosStep2Highlight")}
                  </span>{" "}
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <PlusSquare className="size-3 inline" />
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  3
                </div>
                <div className="flex-1">
                  <span>{t("iosStep3")} </span>
                  <span className="font-semibold text-primary">
                    {t("iosStep3Highlight")}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-xs text-foreground">
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  1
                </div>
                <div className="flex-1">
                  <span>{t("androidStep1")} </span>
                  <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    <MoreVertical className="size-3" /> Menü
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  2
                </div>
                <div className="flex-1">
                  <span>{t("androidStep2")} </span>
                  <span className="font-semibold text-primary underline underline-offset-2">
                    {t("androidStep2Highlight")}
                  </span>{" "}
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <Download className="size-3 inline" />
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                  3
                </div>
                <div className="flex-1">
                  <span>{t("androidStep3")} </span>
                  <span className="font-semibold text-primary">
                    {t("androidStep3Highlight")}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="pt-2">
            <Button
              className="w-full gap-2 text-xs"
              onClick={() => onOpenChange(false)}
            >
              <CheckCircle2 className="size-4" />
              {t("gotIt")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
