"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { updateFacilityBillingEmail } from "./actions";

export function FacilityBillingEmailSection({ billingEmail }: { billingEmail?: string | null }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateFacilityBillingEmail(formData);
      if (res.ok) {
        toast.success(t("updated"));
        router.refresh();
      } else {
        toast.error(c("error"));
      }
    });
  };

  return (
    <div className="rounded-lg border p-6 bg-card max-w-2xl">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <h3 className="font-medium text-lg mb-1">{t("billingEmail")}</h3>
          <p className="text-xs text-muted-foreground">{t("billingEmailHint")}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          <div className="space-y-2 flex-1 w-full">
            <Label htmlFor="facility-billing-email">{t("billingEmail")}</Label>
            <Input
              id="facility-billing-email"
              name="billingEmail"
              type="text"
              defaultValue={billingEmail ?? ""}
              placeholder={t("billingEmailPlaceholder")}
            />
          </div>
          <Button type="submit" disabled={isPending}>{c("save")}</Button>
        </div>
      </form>
    </div>
  );
}
