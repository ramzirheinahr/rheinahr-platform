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
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pin.length !== 6 || loading) return;
    setLoading(true);
    try {
      const result = await loginWithToken(token, pin);

      if (result.ok && result.redirect) {
        // We do a hard navigation to apply the cookie for the new portal context.
        window.location.assign(`/${locale}${result.redirect}`);
        return;
      }
      
      if (result.error === "locked") {
        toast.error(t("locked"));
      } else {
        toast.error(t("wrongPin"));
      }
      setPin("");
      setLoading(false);
    } catch {
      toast.error(c("error"));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="pin">{t("pinLabel")}</Label>
        <Input
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          autoFocus
          required
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="text-center text-2xl tracking-[0.6em]"
          placeholder="••••••"
        />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={loading || pin.length !== 6}>
        {loading ? c("loading") : t("submit")}
      </Button>
    </form>
  );
}
