"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordAction } from "./actions";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const router = useRouter();

  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const password = formData.get("password")?.toString() || "";
    const confirmPassword = formData.get("confirmPassword")?.toString() || "";

    if (password !== confirmPassword) {
      toast.error(t("passwordMismatch"));
      setLoading(false);
      return;
    }

    if (password.length < 12) {
      toast.error(t("passwordMinLength"));
      setLoading(false);
      return;
    }

    const res = await resetPasswordAction(token, formData);
    setLoading(false);

    if (res.ok) {
      toast.success(t("resetPasswordSuccess"));
      router.push("/login");
    } else {
      toast.error(t(res.error as any || "invalidOrExpiredToken"));
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("passwordMinLength")}</p>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? c("loading") : t("resetPasswordButton")}
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
