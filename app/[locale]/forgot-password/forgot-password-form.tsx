"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "./actions";
import { CheckCircle2, ArrowLeft } from "lucide-react";

export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const locale = useLocale();

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    await requestPasswordResetAction(locale, formData);
    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600">
            <CheckCircle2 className="size-8" />
          </div>
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{t("resetLinkSentTitle")}</h3>
          <p className="text-sm text-muted-foreground">{t("resetLinkSentDesc")}</p>
        </div>
        <div className="pt-4">
          <Button variant="outline" render={<Link href="/login" />} className="w-full gap-2">
            <ArrowLeft className="size-4 rtl:rotate-180" />
            {t("backToLogin")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{c("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@beispiel.de"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? c("loading") : t("sendResetLink")}
      </Button>
      <div className="text-center pt-2">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="size-3 rtl:rotate-180" />
          {t("backToLogin")}
        </Link>
      </div>
    </form>
  );
}
