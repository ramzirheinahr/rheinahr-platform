"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PIN entry for the passwordless access link. Verifies against /api/access/verify,
// which sets the session cookie on success; the persistent session then skips this
// screen on the next visit (that's why returning users never see it).
export function PinLoginForm({ token }: { token: string }) {
  const t = useTranslations("access");
  const c = useTranslations("common");
  const router = useRouter();
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
        // Persist the session in the browser (same path as email login), so the
        // portal recognizes us on the next navigation.
        const supabase = createSupabaseBrowserClient();
        const { error } = await supabase.auth.setSession(data.session);
        if (error) {
          toast.error(t("wrongPin"));
          setPin("");
          return;
        }
        router.refresh();
        router.replace(data.redirect);
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
