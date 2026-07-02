"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UserRound } from "lucide-react";
import { PasswordField } from "@/components/admin/password-field";
import { AccountAccessLink } from "@/components/admin/account-access-link";
import {
  resetAccountPassword,
  setAccountActive,
  updateAccountEmail,
} from "@/app/[locale]/admin/account-actions";

// Super-admin block on a worker/client edit page: everything about the login
// account (active flag, password reset, passwordless access link) lives here,
// next to the profile — there is no separate accounts page.
export function AccountSection({
  userId,
  email,
  active,
  hasLink,
}: {
  userId: string;
  email: string;
  active: boolean;
  hasLink: boolean;
}) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [isActive, setIsActive] = useState(active);
  const [activePending, startActive] = useTransition();
  const [emailPending, startEmail] = useTransition();
  const [pwPending, startPw] = useTransition();

  function onToggleActive(next: boolean) {
    setIsActive(next);
    startActive(async () => {
      const res = await setAccountActive(userId, next);
      if (res.ok) {
        toast.success(t("updated"));
        router.refresh();
      } else {
        setIsActive(!next);
        toast.error(t(res.error === "forbidden" ? "forbidden" : "saveError"));
      }
    });
  }

  function onSaveEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startEmail(async () => {
      const res = await updateAccountEmail(userId, formData);
      if (res.ok) {
        toast.success(t("emailUpdated"));
        router.refresh();
      } else {
        const key =
          res.error === "emailInUse" || res.error === "forbidden"
            ? res.error
            : "saveError";
        toast.error(t(key));
      }
    });
  }

  function onResetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startPw(async () => {
      const res = await resetAccountPassword(userId, formData);
      if (res.ok) {
        toast.success(t("passwordReset"));
        form.reset();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-6 rounded-lg border p-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <UserRound className="size-4" />
          {t("accountSection")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("accountHint")}</p>
      </div>

      <form onSubmit={onSaveEmail} className="space-y-3">
        <Label htmlFor="account-email">{t("email")}</Label>
        <div className="flex flex-wrap gap-3">
          <Input
            id="account-email"
            name="email"
            type="email"
            required
            defaultValue={email}
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary" disabled={emailPending}>
            {t("saveEmail")}
          </Button>
        </div>
      </form>

      <Separator />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isActive}
          disabled={activePending}
          onChange={(e) => onToggleActive(e.target.checked)}
          className="size-4 accent-primary"
        />
        {t("active")}
      </label>

      <Separator />

      <form onSubmit={onResetPassword} className="space-y-3">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <PasswordField
          placeholder={t("passwordHint")}
          trailing={
            <Button type="submit" disabled={pwPending}>
              {t("resetPassword")}
            </Button>
          }
        />
      </form>

      <Separator />

      <AccountAccessLink accountId={userId} hasLink={hasLink} />
    </div>
  );
}
