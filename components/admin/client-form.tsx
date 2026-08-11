"use client";

import { useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { facilityTypes, type qualifications } from "@/lib/validations";
import { FacilityNameCodeFields } from "@/components/admin/facility-name-code-fields";
import { HourlyRatesFieldset } from "@/components/admin/hourly-rates-fieldset";
import { updateClient } from "@/app/[locale]/admin/clients/actions";

type ClientData = {
  id: string;
  facilityName: string;
  internalNumber?: string | null;
  shortCode: string | null;
  facilityType: string;
  address: string | null;

  contactPerson: string | null;
  billingInfo: string | null;
  paymentTermsDays: number;
  // Surcharge overrides stored as fractions (0.25) — shown here as percent.
  surchargeSat: number | null;
  surchargeSun: number | null;
  surchargeHoliday: number | null;
  surchargeNight: number | null;
  // Night window (HH:mm) or null → platform default (20:00–06:00).
  nightStart: string | null;
  nightEnd: string | null;
  // Per-qualification hourly rate overrides (EUR), missing = platform default.
  hourlyRates: Partial<Record<(typeof qualifications)[number], number | null>>;
  user: {
    receiveEmails: boolean;
  };
};

const toPct = (v: number | null) =>
  v === null || v === undefined ? "" : String(Math.round(v * 1000) / 10);

// Edits an existing facility profile; the login account is managed in the
// AccountSection rendered next to this form.
export function ClientForm({ client, customFacilityTypes = [] }: { client: ClientData, customFacilityTypes?: string[] }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const ef = useTranslations("enums.facilityType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [initialClient] = useState(client);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const promise = updateClient(client.id, formData).then((res) => {
      if (res.ok) {
        startTransition(() => {
          router.refresh();
        });
        return res;
      }
      throw new Error(res.error === "codeInUse" ? "codeInUse" : "saveError");
    });

    toast.promise(promise, {
      loading: c("loading") || "Speichern...",
      success: t("updated"),
      error: (err) => t(err.message === "codeInUse" ? "codeInUse" : "saveError"),
    });

    router.back();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FacilityNameCodeFields
          defaultName={initialClient.facilityName}
          defaultCode={initialClient.shortCode ?? ""}
        />
        <div className="space-y-2">
          <Label htmlFor="internalNumber">Interne Nummer</Label>
          <Input
            id="internalNumber"
            name="internalNumber"
            defaultValue={initialClient.internalNumber || ""}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("facilityType")}</Label>
          <Combobox
            name="facilityType"
            defaultValue={[initialClient.facilityType]}
            options={[
              ...facilityTypes.map((f) => ({ value: f, label: ef(f) })),
              ...customFacilityTypes.map((f) => ({ value: f, label: f })),
            ]}
            allowCreate
            placeholder={t("facilityType")}
          />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
          <Input
            id="contactPerson"
            name="contactPerson"
            defaultValue={initialClient.contactPerson ?? ""}
          />
        </div>
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("address")}</legend>
        <div className="space-y-2 mt-2">
          <Textarea id="address" name="address" defaultValue={initialClient.address ?? ""} rows={3} />
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("billingInfo")}</legend>
        <div className="space-y-2 mt-2">
          <Textarea
            id="billingInfo"
            name="billingInfo"
            defaultValue={initialClient.billingInfo ?? ""}
            rows={3}
          />
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="paymentTermsDays">Zahlungsziel (Tage)</Label>
          <Input
            id="paymentTermsDays"
            name="paymentTermsDays"
            type="number"
            min={0}
            step={1}
            defaultValue={initialClient.paymentTermsDays ?? 14}
          />
        </div>
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
              defaultValue={toPct(initialClient.surchargeSat)}
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
              defaultValue={toPct(initialClient.surchargeSun)}
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
              defaultValue={toPct(initialClient.surchargeHoliday)}
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
              defaultValue={toPct(initialClient.surchargeNight)}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nightStart">{t("nightStart")}</Label>
            <Input
              id="nightStart"
              name="nightStart"
              type="time"
              defaultValue={initialClient.nightStart ?? "20:00"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nightEnd">{t("nightEnd")}</Label>
            <Input
              id="nightEnd"
              name="nightEnd"
              type="time"
              defaultValue={initialClient.nightEnd ?? "06:00"}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("nightWindowHint")}</p>
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="receiveEmails"
          name="receiveEmails"
          defaultChecked={initialClient.user?.receiveEmails ?? true}
          className="size-4"
        />
        <Label htmlFor="receiveEmails">E-Mail Benachrichtigungen senden</Label>
      </div>

      <HourlyRatesFieldset values={initialClient.hourlyRates} />

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          {c("cancel")}
        </Button>
      </div>
    </form>
  );
}
