"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAdminUser, updateAdminUser } from "./actions";

const PERMISSIONS = [
  "manage_workers",
  "manage_clients",
  "manage_orders",
  "manage_confirmations",
  "manage_invoices",
];

export function UserForm({
  user,
}: {
  user?: { id: string; fullName: string | null; email: string; active: boolean; permissions: string[] };
}) {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const locale = window.location.pathname.split('/')[1] || 'de';

    startTransition(async () => {
      const res = user
        ? await updateAdminUser(locale, user.id, formData)
        : await createAdminUser(locale, formData);

      if (res.ok) {
        router.push("/admin/users");
        router.refresh();
      } else {
        setError(t(res.error as any));
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-card border rounded-lg p-6">
      {error && <div className="text-red-500 font-medium mb-4">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t("name")}</Label>
          <Input id="fullName" name="fullName" defaultValue={user?.fullName || ""} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" defaultValue={user?.email || ""} required />
        </div>
      </div>

      {!user && (
        <div className="space-y-2">
          <Label htmlFor="password">{c("password")}</Label>
          <Input id="password" name="password" type="password" required minLength={12} />
        </div>
      )}

      <div className="space-y-4 pt-4 border-t">
        <h3 className="font-medium text-lg">{t("permissions")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {PERMISSIONS.map((p) => (
            <div key={p} className="flex items-center space-x-2">
              <input
                type="checkbox"
                id={`perm-${p}`}
                name="permissions"
                value={p}
                defaultChecked={user?.permissions.includes(p)}
                className="size-4 accent-primary"
              />
              <Label htmlFor={`perm-${p}`} className="font-normal cursor-pointer">
                {t(`permissionsList.${p}` as any)}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t">
        <div className="flex items-center space-x-2">
          <input 
            type="checkbox" 
            id="active" 
            name="active" 
            defaultChecked={user?.active ?? true} 
            className="size-4 accent-primary" 
          />
          <Label htmlFor="active">{t("active")}</Label>
        </div>

        <div className="flex gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
            {c("cancel")}
          </Button>
          <Button type="submit" disabled={isPending}>
            {c("save")}
          </Button>
        </div>
      </div>
    </form>
  );
}
