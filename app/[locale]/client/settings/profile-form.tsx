"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateMyEmail, updateMyPassword } from "./actions";

export function ClientProfileForm({ userId, email }: { userId: string; email: string }) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const [emailPending, startEmail] = useTransition();
  const [pwPending, startPw] = useTransition();

  function onSaveEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startEmail(async () => {
      const res = await updateMyEmail(formData);
      if (res.ok) {
        toast.success(t("emailUpdated"));
        router.refresh();
      } else {
        toast.error(t(res.error === "emailInUse" ? "emailInUse" : "saveError"));
      }
    });
  }

  function onResetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startPw(async () => {
      const res = await updateMyPassword(formData);
      if (res.ok) {
        toast.success(t("passwordReset"));
        form.reset();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="space-y-8 rounded-lg border p-6 bg-card max-w-2xl">
      <form onSubmit={onSaveEmail} className="space-y-4">
        <h3 className="font-medium text-lg">E-Mail</h3>
        <div className="flex gap-4 items-end">
          <div className="space-y-2 flex-1">
            <Label htmlFor="account-email">{t("email")}</Label>
            <Input id="account-email" name="email" type="email" required defaultValue={email} />
          </div>
          <Button type="submit" disabled={emailPending}>{t("saveEmail")}</Button>
        </div>
      </form>

      <form onSubmit={onResetPassword} className="space-y-4 pt-6 border-t">
        <h3 className="font-medium text-lg">Passwort ändern</h3>
        <div className="flex gap-4 items-end">
          <div className="space-y-2 flex-1">
            <Label htmlFor="password">{t("newPassword")}</Label>
            <Input id="password" name="password" type="password" required minLength={12} placeholder={t("passwordHint")} />
          </div>
          <Button type="submit" disabled={pwPending}>{t("resetPassword")}</Button>
        </div>
      </form>
    </div>
  );
}
