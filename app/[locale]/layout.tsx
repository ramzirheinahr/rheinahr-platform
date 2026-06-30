import type { Metadata } from "next";
import localFont from "next/font/local";
import "../globals.css";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { CookieConsent } from "@/components/cookie-consent";
import { routing, localeDirection, type Locale } from "@/i18n/routing";

const geistSans = localFont({
  src: "../fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "../fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "RheinAhr Dienstleistungen GmbH — Pflege- & Personaldienstleistung",
  description:
    "Digitale Koordination qualifizierter Pflege- und Fachkräfte für Krankenhäuser, Pflegeheime und Kliniken.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);
  const dir = localeDirection[locale as Locale];

  return (
    <html lang={locale} dir={dir}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider>
          {children}
          <CookieConsent />
        </NextIntlClientProvider>
        <Toaster richColors position={dir === "rtl" ? "bottom-left" : "bottom-right"} />
      </body>
    </html>
  );
}
