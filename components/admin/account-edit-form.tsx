"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignableRoles } from "@/lib/validations";
import {
  updateAccount,
  resetAccountPassword,
} from "@/app/[locale]/admin/accounts/actions";

type AssignableRole = (typeof assignableRoles)[number];

type AccountData = {
  id: string;
  fullName: string | null;
  email: string;
  role: AssignableRole;
  active: boolean;
};

export function AccountEditForm({ account }: { account: AccountData }) {
  const t = useTranslations("accounts");
  const c = useTranslations("common");
  const er = useTranslations("enums.role");
  const router = useRouter();
  const [savePending, startSave] = useTransition();
  const [pwPending, startPw] = useTransition();
  const [role, setRole] = useState<AssignableRole>(account.role);

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startSave(async () => {
      const res = await updateAccount(account.id, formData);
      if (res.ok) {
        toast.success(t("updated"));
        router.push("/admin/accounts");
        router.refresh();
      } else {
        const key =
          res.error === "selfEdit" || res.error === "forbidden"
            ? res.error
            : "saveError";
        toast.error(t(key));
      }
    });
  }

  function onResetPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startPw(async () => {
      const res = await resetAccountPassword(account.id, formData);
      if (res.ok) {
        toast.success(t("passwordReset"));
        (e.target as HTMLFormElement).reset();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-8">
      <form onSubmit={onSave} className="space-y-5">
        <div className="space-y-2">
          <Label>{t("email")}</Label>
          <Input value={account.email} disabled />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullName">{t("fullName")}</Label>
            <Input
              id="fullName"
              name="fullName"
              required
              defaultValue={account.fullName ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("role")}</Label>
            <Select
              name="role"
              value={role}
              onValueChange={(v) => setRole(v as AssignableRole)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {er(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="active"
            defaultChecked={account.active}
            className="size-4 accent-primary"
          />
          {t("active")}
        </label>
        <div className="flex gap-3">
          <Button type="submit" disabled={savePending}>
            {savePending ? c("loading") : c("save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/accounts")}
          >
            {c("cancel")}
          </Button>
        </div>
      </form>

      <Separator />

      <form onSubmit={onResetPassword} className="space-y-3">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <div className="flex gap-3">
          <Input
            id="password"
            name="password"
            type="text"
            minLength={12}
            placeholder={t("passwordHint")}
            required
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary" disabled={pwPending}>
            {t("resetPassword")}
          </Button>
        </div>
      </form>
    </div>
  );
}
