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
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/access/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
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
          setLoading(false);
          return;
        }
        // Full page load so the server receives the freshly written session cookie
        // (a soft SPA navigation can race the cookie write and bounce to /login).
        window.location.assign(`/${locale}${data.redirect}`);
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
