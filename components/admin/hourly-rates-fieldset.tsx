"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { qualifications } from "@/lib/validations";
import { DEFAULT_RATES } from "@/lib/pricing";

// Per-qualification hourly rate override inputs, shared by the facility
// create and edit forms. Each input's placeholder is the platform default;
// leaving it blank keeps that default. Values are submitted as `rate<Qual>`
// form fields and turned into the Client.hourlyRates JSON on the server.
const FIELD: Record<(typeof qualifications)[number], string> = {
  pflegefachkraft: "ratePflegefachkraft",
  pflegehelfer: "ratePflegehelfer",
  betreuungskraft: "rateBetreuungskraft",
  pflegedienstleitung: "ratePflegedienstleitung",
};

export function HourlyRatesFieldset({
  values,
}: {
  // Current overrides to prefill (edit form); omitted on create.
  values?: Partial<Record<(typeof qualifications)[number], number | null>>;
}) {
  const t = useTranslations("clients");
  const eq = useTranslations("enums.qualification");

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-medium">{t("hourlyRates")}</legend>
      <p className="text-xs text-muted-foreground">{t("hourlyRatesHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {qualifications.map((q) => (
          <div key={q} className="space-y-2">
            <Label htmlFor={FIELD[q]}>{eq(q)}</Label>
            <div className="relative">
              <Input
                id={FIELD[q]}
                name={FIELD[q]}
                type="number"
                min={0}
                max={1000}
                step="0.01"
                inputMode="decimal"
                placeholder={String(DEFAULT_RATES[q])}
                defaultValue={values?.[q] != null ? String(values[q]) : ""}
                className="pe-8"
              />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground">
                €
              </span>
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
