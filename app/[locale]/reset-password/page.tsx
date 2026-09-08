import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyPasswordResetToken } from "@/lib/password-reset";
import { ResetPasswordForm } from "./reset-password-form";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("auth");

  const verified = token ? await verifyPasswordResetToken(token) : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 p-6">
      <div className="flex w-full max-w-sm items-center justify-between">
        <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH">
          <Logo className="h-10 w-auto" priority />
        </Link>
        <LocaleSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        {verified && token ? (
          <>
            <CardHeader>
              <CardTitle>{t("resetPasswordTitle")}</CardTitle>
              <CardDescription>{t("resetPasswordSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ResetPasswordForm token={token} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-2">
                <div className="rounded-full bg-destructive/10 p-3 text-destructive">
                  <AlertCircle className="size-8" />
                </div>
              </div>
              <CardTitle>{t("invalidTokenTitle")}</CardTitle>
              <CardDescription>{t("invalidOrExpiredToken")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button render={<Link href="/forgot-password" />} className="w-full">
                {t("requestNewLink")}
              </Button>
              <div className="text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                >
                  <ArrowLeft className="size-3 rtl:rotate-180" />
                  {t("backToLogin")}
                </Link>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
