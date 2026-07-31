"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { loginWithToken } from "@/app/[locale]/login/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PIN entry for the passwordless access link. Verifies against /api/access/verify,
// which returns session tokens; the browser persists them (same path as the email
// login), then a full page load lands on the portal with the session cookie set.
// The persistent session then skips this screen on the next visit.
export function PinLoginForm({ token }: { token: string }) {
  const t = useTranslations("access");
  const c = useTranslations("common");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await loginWithToken(token);

      if (result.ok && result.redirect) {
        // We do a hard navigation to apply the cookie for the new portal context.
        window.location.assign(`/${locale}${result.redirect}`);
        return;
      }
      toast.error(c("error"));
      setLoading(false);
    } catch {
      toast.error(c("error"));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={onLogin} className="w-full" size="lg" disabled={loading}>
        {loading ? c("loading") : t("submit")}
      </Button>
    </div>
  );
}
