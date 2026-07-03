"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { facilityTypes } from "@/lib/validations";
import { updateClient } from "@/app/[locale]/admin/clients/actions";

type ClientData = {
  id: string;
  facilityName: string;
  shortCode: string | null;
  facilityType: string;
  address: string | null;
  contactPerson: string | null;
  billingInfo: string | null;
  // Surcharge overrides stored as fractions (0.25) — shown here as percent.
  surchargeSat: number | null;
  surchargeSun: number | null;
  surchargeHoliday: number | null;
};

const toPct = (v: number | null) =>
  v === null || v === undefined ? "" : String(Math.round(v * 1000) / 10);

// Edits an existing facility profile; the login account is managed in the
// AccountSection rendered next to this form.
export function ClientForm({ client }: { client: ClientData }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const ef = useTranslations("enums.facilityType");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateClient(client.id, formData);
      if (res.ok) {
        toast.success(t("updated"));
        router.push("/admin/clients");
        router.refresh();
      } else {
        toast.error(t(res.error === "codeInUse" ? "codeInUse" : "saveError"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="facilityName">{t("facilityName")}</Label>
          <Input
            id="facilityName"
            name="facilityName"
            required
            defaultValue={client.facilityName}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shortCode">{t("shortCode")}</Label>
          <Input
            id="shortCode"
            name="shortCode"
            maxLength={3}
            placeholder="WB"
            className="uppercase sm:max-w-28"
            defaultValue={client.shortCode ?? ""}
          />
          <p className="text-xs text-muted-foreground">{t("shortCodeHint")}</p>
        </div>
        <div className="space-y-2">
          <Label>{t("facilityType")}</Label>
          <Select name="facilityType" defaultValue={client.facilityType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {facilityTypes.map((f) => (
                <SelectItem key={f} value={f}>
                  {ef(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contactPerson">{t("contactPerson")}</Label>
          <Input
            id="contactPerson"
            name="contactPerson"
            defaultValue={client.contactPerson ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="address">{t("address")}</Label>
          <Input id="address" name="address" defaultValue={client.address ?? ""} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="billingInfo">{t("billingInfo")}</Label>
        <Input
          id="billingInfo"
          name="billingInfo"
          defaultValue={client.billingInfo ?? ""}
        />
      </div>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">{t("surcharges")}</legend>
        <p className="text-xs text-muted-foreground">{t("surchargesHint")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
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
              defaultValue={toPct(client.surchargeSat)}
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
              defaultValue={toPct(client.surchargeSun)}
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
              defaultValue={toPct(client.surchargeHoliday)}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? c("loading") : c("save")}
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
