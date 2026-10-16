"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveClientPricingDraftAction } from "@/app/[locale]/admin/clients/[id]/rates/actions";
import { DEFAULT_NIGHT_WINDOW, DEFAULT_SURCHARGES } from "@/lib/pricing";

export type QualificationDisplay = {
  code: string; nameDe: string; nameEn: string; nameAr: string;
  defaultClientRateCents: number | null; active: boolean;
};

export function displayQualification(item: QualificationDisplay, locale: string): string {
  return locale === "ar" ? item.nameAr : locale === "en" ? item.nameEn : item.nameDe;
}

type Surcharges = {
  surchargeSat: number | null;
  surchargeSun: number | null;
  surchargeHoliday: number | null;
  surchargeNight: number | null;
  nightStart: string | null;
  nightEnd: string | null;
};

const asOptionalNumber = (value: string) => value.trim() === "" ? null : Number(value);
const percentage = (value: number | null) => value === null ? "" : String(Math.round(value * 10000) / 100);

export function ClientPricingEditor({
  clientId, expectedUpdatedAt, profileSurcharges, profileHourlyRates,
  qualifications,
  onDirtyChange,
}: {
  clientId: string;
  expectedUpdatedAt: string;
  profileSurcharges: Surcharges;
  profileHourlyRates: Record<string, number | null>;
  qualifications: QualificationDisplay[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("ratesApproval");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(expectedUpdatedAt);
  const [surcharges, setSurcharges] = useState({
    surchargeSat: percentage(profileSurcharges.surchargeSat ?? DEFAULT_SURCHARGES.sat),
    surchargeSun: percentage(profileSurcharges.surchargeSun ?? DEFAULT_SURCHARGES.sun),
    surchargeHoliday: percentage(profileSurcharges.surchargeHoliday ?? DEFAULT_SURCHARGES.holiday),
    surchargeNight: percentage(profileSurcharges.surchargeNight ?? DEFAULT_SURCHARGES.night),
  });
  const [nightStart, setNightStart] = useState(profileSurcharges.nightStart ?? DEFAULT_NIGHT_WINDOW.start);
  const [nightEnd, setNightEnd] = useState(profileSurcharges.nightEnd ?? DEFAULT_NIGHT_WINDOW.end);
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(
    qualifications.map(({ code }) => [code, profileHourlyRates[code] === null || profileHourlyRates[code] === undefined ? "" : String(profileHourlyRates[code])]),
  ));

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveClientPricingDraftAction({
        clientId,
        expectedUpdatedAt: revision,
        surchargeSatPct: asOptionalNumber(surcharges.surchargeSat),
        surchargeSunPct: asOptionalNumber(surcharges.surchargeSun),
        surchargeHolidayPct: asOptionalNumber(surcharges.surchargeHoliday),
        surchargeNightPct: asOptionalNumber(surcharges.surchargeNight),
        nightStart: nightStart || null,
        nightEnd: nightEnd || null,
        hourlyRates: Object.fromEntries(qualifications.map(({ code }) => [code, asOptionalNumber(rates[code] ?? "")])),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRevision(result.data.updatedAt);
      toast.success(t("pricingSaved"));
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} onChange={() => onDirtyChange(true)} className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("profileSurcharges")}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["surchargeSat", "surchargeSun", "surchargeHoliday", "surchargeNight"] as const).map((key) => (
            <div key={key} className="min-w-0 space-y-2">
              <Label htmlFor={`pricing-${key}`}>{t(key)}</Label>
              <Input
                id={`pricing-${key}`}
                type="number"
                min="0"
                max="200"
                step="0.01"
                inputMode="decimal"
                value={surcharges[key]}
                onChange={(event) => setSurcharges((previous) => ({ ...previous, [key]: event.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pricing-night-start">{t("nightStart")}</Label>
            <Input id="pricing-night-start" type="time" value={nightStart} onChange={(event) => setNightStart(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pricing-night-end">{t("nightEnd")}</Label>
            <Input id="pricing-night-end" type="time" value={nightEnd} onChange={(event) => setNightEnd(event.target.value)} />
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("profileRates")}</h3>
        <p className="text-xs text-muted-foreground">{t("ratesEffectiveToday")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {qualifications.map((item) => (
            <div key={item.code} className="min-w-0 space-y-2">
              <Label htmlFor={`pricing-rate-${item.code}`}>{displayQualification(item, locale)} (€ / Std.)</Label>
              <Input
                id={`pricing-rate-${item.code}`}
                type="number"
                min="0"
                max="1000"
                step="0.01"
                inputMode="decimal"
                placeholder={item.defaultClientRateCents === null ? "—" : (item.defaultClientRateCents / 100).toFixed(2)}
                value={rates[item.code] ?? ""}
                onChange={(event) => setRates((previous) => ({ ...previous, [item.code]: event.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{rates[item.code] === "" ? t("inheritedDefaultRate") : t("clientOverrideRate")}</p>
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("pricingSaving") : t("pricingSave")}</Button>
    </form>
  );
}
