"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { COUNTRY_CODES, countryLabel } from "@/lib/countries";

// Single-select nationality (ISO 3166-1 alpha-2), sorted by localized country
// name in the current UI locale.
export function NationalitySelect({
  name = "nationality",
  defaultValue,
}: {
  name?: string;
  defaultValue?: string | null;
}) {
  const locale = useLocale();
  const t = useTranslations("workers");

  const options: ComboOption[] = useMemo(
    () =>
      COUNTRY_CODES.map((code) => ({
        value: code,
        label: countryLabel(code, locale),
      })).sort((a, b) => a.label.localeCompare(b.label, locale)),
    [locale],
  );

  return (
    <Combobox
      options={options}
      name={name}
      defaultValue={defaultValue ? [defaultValue] : []}
      placeholder={t("nationalityPlaceholder")}
      searchPlaceholder={t("searchCountry")}
      emptyText={t("noResults")}
    />
  );
}
