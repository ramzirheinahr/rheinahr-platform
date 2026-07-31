"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { loginUser } from "@/app/[locale]/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LoginForm() {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const result = await loginUser(email, password);
    setLoading(false);

    if (!result.ok) {
      toast.error(t(result.error || "invalidCredentials"));
      return;
    }
    // Route to the portal by role (server guards self-correct any mismatch).
    // Fall back to /dashboard, which resolves the role server-side.
    const role = result.role as string | undefined;
    const dest =
      role === "client"
        ? "/client"
        : role === "worker"
          ? "/worker"
          : role
            ? "/admin"
            : "/dashboard";
    router.refresh();
    router.push(dest);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{c("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{c("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? c("loading") : c("login")}
      </Button>
    </form>
  );
}
