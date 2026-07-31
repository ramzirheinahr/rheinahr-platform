"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { loginWithToken } from "@/app/[locale]/login/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function TokenLoginButton({ token }: { token: string }) {
  const c = useTranslations("common");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await loginWithToken(token);

      if (result.ok && result.redirect) {
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
    <Button onClick={onLogin} className="w-full" size="lg" disabled={loading}>
      {loading ? c("loading") : "Anmelden"}
    </Button>
  );
}
