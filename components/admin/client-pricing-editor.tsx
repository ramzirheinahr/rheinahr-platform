"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveClientPricingDraftAction } from "@/app/[locale]/admin/clients/[id]/rates/actions";
import { DEFAULT_NIGHT_WINDOW, DEFAULT_RATES, DEFAULT_SURCHARGES } from "@/lib/pricing";

const qualifications = [
  "pflegefachkraft", "pflegehelfer", "betreuungskraft",
  "pflegedienstleitung", "kuechenhilfe", "hausmeister",
] as const;

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
  onDirtyChange,
}: {
  clientId: string;
  expectedUpdatedAt: string;
  profileSurcharges: Surcharges;
  profileHourlyRates: Record<string, number | null>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("ratesApproval");
  const eq = useTranslations("enums.qualification");
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
    qualifications.map((key) => [key, String(profileHourlyRates[key] ?? DEFAULT_RATES[key])]),
  ));
  const hasLegacyDefaults = (
    profileSurcharges.surchargeSat === null ||
    profileSurcharges.surchargeSun === null ||
    profileSurcharges.surchargeHoliday === null ||
    profileSurcharges.surchargeNight === null ||
    profileSurcharges.nightStart === null ||
    profileSurcharges.nightEnd === null ||
    qualifications.some((key) => profileHourlyRates[key] == null)
  );

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
        hourlyRates: Object.fromEntries(qualifications.map((key) => [key, asOptionalNumber(rates[key] ?? "")])) as Record<typeof qualifications[number], number | null>,
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
      <p className="text-sm text-muted-foreground">{t("pricingEditHint")}</p>
      {hasLegacyDefaults && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {t("legacyDefaultsReviewHint")}
        </p>
      )}
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
              {profileSurcharges[key] === null && <p className="text-xs text-amber-700 dark:text-amber-300">{t("legacyDefaultValue")}</p>}
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {qualifications.map((key) => (
            <div key={key} className="min-w-0 space-y-2">
              <Label htmlFor={`pricing-rate-${key}`}>{eq(key)} (€ / Std.)</Label>
              <Input
                id={`pricing-rate-${key}`}
                type="number"
                min="0"
                max="1000"
                step="0.01"
                inputMode="decimal"
                value={rates[key] ?? ""}
                onChange={(event) => setRates((previous) => ({ ...previous, [key]: event.target.value }))}
              />
              {profileHourlyRates[key] == null && <p className="text-xs text-amber-700 dark:text-amber-300">{t("legacyDefaultValue")}</p>}
            </div>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("pricingSaving") : t("pricingSave")}</Button>
    </form>
  );
}
