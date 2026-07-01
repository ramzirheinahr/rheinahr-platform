"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
      const res = await fetch("/api/access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok: boolean;
            error?: string;
            redirect?: string;
            session?: { access_token: string; refresh_token: string };
          }
        | null;

      if (res.ok && data?.ok && data.redirect && data.session) {
        // Persist the session in the browser (same path as email login).
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.setSession(data.session);
        // Confirm the session is actually stored before navigating away.
        const { data: check } = await supabase.auth.getSession();
        if (error || !check.session) {
          toast.error(c("error"));
          setPin("");
          return;
        }
        // Full page load so the server receives the freshly written session cookie
        // (a soft SPA navigation can race the cookie write and bounce to /login).
        window.location.assign(`/${locale}${data.redirect}`);
        return;
      }
      if (res.status === 429 || data?.error === "locked") {
        toast.error(t("locked"));
      } else {
        toast.error(t("wrongPin"));
      }
      setPin("");
    } catch {
      toast.error(c("error"));
    } finally {
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
      <Button type="submit" className="w-full" disabled={loading || pin.length !== 6}>
        {loading ? c("loading") : t("submit")}
      </Button>
    </form>
  );
}
