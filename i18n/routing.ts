import { defineRouting } from "next-intl/routing";

// DE/EN/AR — German default per CLAUDE.md §9. Arabic renders RTL (see localeDirection).
export const routing = defineRouting({
  locales: ["de", "en", "ar"],
  defaultLocale: "de",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

export const localeDirection: Record<Locale, "ltr" | "rtl"> = {
  de: "ltr",
  en: "ltr",
  ar: "rtl",
};

export const localeLabels: Record<Locale, string> = {
  de: "Deutsch",
  en: "English",
  ar: "العربية",
};
