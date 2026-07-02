"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import {
  LANGUAGE_OPTIONS,
  PRIMARY_LANGUAGES,
  languageLabel,
} from "@/lib/languages";

// Multi-select of spoken languages. The three primary languages stay pinned at
// the top; the rest are sorted by their localized name in the current UI locale.
export function LanguageSelect({
  name = "languages",
  defaultValue = [],
}: {
  name?: string;
  defaultValue?: string[];
}) {
  const locale = useLocale();
  const t = useTranslations("workers");

  const options: ComboOption[] = useMemo(() => {
    const primary = PRIMARY_LANGUAGES.map((code) => ({
      value: code,
      label: languageLabel(code, locale),
    }));
    const rest = LANGUAGE_OPTIONS.filter(
      (code) => !PRIMARY_LANGUAGES.includes(code as never),
    )
      .map((code) => ({ value: code, label: languageLabel(code, locale) }))
      .sort((a, b) => a.label.localeCompare(b.label, locale));
    return [...primary, ...rest];
  }, [locale]);

  return (
    <Combobox
      options={options}
      name={name}
      multiple
      defaultValue={defaultValue}
      placeholder={t("languagesPlaceholder")}
      searchPlaceholder={t("searchLanguage")}
      emptyText={t("noResults")}
    />
  );
}
