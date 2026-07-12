import { getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, portalPath } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { PinLoginForm } from "@/components/auth/pin-login-form";
import { PwaInstallHint } from "@/components/pwa-install-hint";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";

// Reads the session (persistent login skips the PIN) — must not be cached.
export const dynamic = "force-dynamic";

export default async function AccessPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;

  // Already signed in on this device → straight to the portal (no PIN re-entry).
  const existing = await getCurrentUser();
  if (existing) redirect({ href: portalPath(existing.role), locale: locale as Locale });

  const t = await getTranslations("access");

  // The link is valid only if it maps to an active account with a PIN set.
  const account = await prisma.user
    .findUnique({
      where: { loginToken: token },
      select: { active: true, loginPinHash: true, fullName: true },
    })
    .catch(() => null);
  const valid = !!account && account.active && !!account.loginPinHash;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 p-6">
      <div className="flex w-full max-w-sm items-center justify-between">
        <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH">
          <Logo className="h-10 w-auto" priority />
        </Link>
        <LocaleSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        {valid ? (
          <>
            <CardHeader>
              <CardTitle>
                {account!.fullName
                  ? t("welcome", { name: account!.fullName })
                  : t("welcomeGeneric")}
              </CardTitle>
              <CardDescription>{t("clickToLogin") || "Click the button below to securely sign in."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <PinLoginForm token={token} />
              <PwaInstallHint />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t("invalidTitle")}</CardTitle>
              <CardDescription>{t("invalidBody")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login" className="text-sm text-primary underline">
                {t("goToLogin")}
              </Link>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
