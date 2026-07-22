"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import { facilityTypes } from "@/lib/validations";
import { PasswordField } from "@/components/admin/password-field";
import { FacilityNameCodeFields } from "@/components/admin/facility-name-code-fields";
import { HourlyRatesFieldset } from "@/components/admin/hourly-rates-fieldset";
import { createClient } from "@/app/[locale]/admin/clients/actions";

// Creates a facility together with its login account (super_admin only) —
// profile and credentials in one step, no separate accounts page.
export function ClientCreateForm({ customFacilityTypes = [] }: { customFacilityTypes?: string[] }) {
  const t = useTranslations("clients");
  const ta = useTranslations("accounts");
  const c = useTranslations("common");
  const ef = useTranslations("enums.facilityType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createClient(formData);
      if (res.ok) {
        toast.success(t("created"));
        router.push("/admin/clients");
        router.refresh();
      } else {
        toast.error(
          t(
            res.error === "emailInUse"
              ? "emailInUse"
              : res.error === "codeInUse"
                ? "codeInUse"
                : "saveError",
          ),
        );
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FacilityNameCodeFields />
        <div className="space-y-2">
          <Label>{t("facilityType")}</Label>
          <Combobox
            name="facilityType"
            defaultValue={[facilityTypes[0]]}
            options={[
              ...facilityTypes.map((f) => ({ value: f, label: ef(f) })),
              ...customFacilityTypes.map((f) => ({ value: f, label: f })),
            ]}
            allowCreate
            placeholder={t("facilityType")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required className="sm:max-w-sm" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{ta("password")}</Label>
        <PasswordField placeholder={ta("passwordHint")} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
          <Input id="contactPerson" name="contactPerson" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" name="address" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="billingInfo">{t("billingInfo")}</Label>
        <Input id="billingInfo" name="billingInfo" />
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("surcharges")}</legend>
        <p className="text-xs text-muted-foreground">{t("surchargesHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="surchargeSat">{t("surchargeSat")}</Label>
            <Input
              id="surchargeSat"
              name="surchargeSat"
              type="number"
              min={0}
              max={500}
              step={1}
              inputMode="decimal"
              placeholder="25"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="surchargeSun">{t("surchargeSun")}</Label>
            <Input
              id="surchargeSun"
              name="surchargeSun"
              type="number"
              min={0}
              max={500}
              step={1}
              inputMode="decimal"
              placeholder="50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="surchargeHoliday">{t("surchargeHoliday")}</Label>
            <Input
              id="surchargeHoliday"
              name="surchargeHoliday"
              type="number"
              min={0}
              max={500}
              step={1}
              inputMode="decimal"
              placeholder="100"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="surchargeNight">{t("surchargeNight")}</Label>
            <Input
              id="surchargeNight"
              name="surchargeNight"
              type="number"
              min={0}
              max={500}
              step={1}
              inputMode="decimal"
              placeholder="25"
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nightStart">{t("nightStart")}</Label>
            <Input id="nightStart" name="nightStart" type="time" defaultValue="20:00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nightEnd">{t("nightEnd")}</Label>
            <Input id="nightEnd" name="nightEnd" type="time" defaultValue="06:00" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("nightWindowHint")}</p>
      </fieldset>

      <HourlyRatesFieldset />

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("create")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/clients")}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
