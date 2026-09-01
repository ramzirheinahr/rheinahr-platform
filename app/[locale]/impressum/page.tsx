import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalShell } from "@/components/legal/legal-shell";
import { companyConfig } from "@/lib/config/company";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Impressum — ${companyConfig.name}`,
  };
}

export default async function ImpressumPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell title="Impressum">
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        {companyConfig.name}
        <br />
        {companyConfig.street}
        <br />
        {companyConfig.city}
        <br />
        Deutschland
      </p>

      <h2>Vertreten durch</h2>
      <p>Geschäftsführer: {companyConfig.ceo}</p>

      <h2>Kontakt</h2>
      <p>
        Telefon: <a href={`tel:${companyConfig.phone.replace(/[^0-9+]/g, '')}`}>{companyConfig.phone}</a>
        <br />
        Telefax: {companyConfig.fax}
        <br />
        E-Mail: <a href={`mailto:${companyConfig.email}`}>{companyConfig.email}</a>
        <br />
        Web: <a href={companyConfig.websiteUrl}>{companyConfig.website}</a>
      </p>

      <h2>Registereintrag</h2>
      <p>
        Eintragung im Handelsregister
        <br />
        Registergericht: {companyConfig.registryCourt}
        <br />
        Registernummer: {companyConfig.hrb}
      </p>

      <h2>Umsatzsteuer-ID</h2>
      <p>
        Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:
        <br />
        {companyConfig.vatId}
      </p>

      <h2>Erlaubnis nach dem Arbeitnehmerüberlassungsgesetz (AÜG)</h2>
      <p>
        Erlaubnis zur Arbeitnehmerüberlassung gemäß § 1 AÜG.
        <br />
        Zuständige Aufsichtsbehörde:
        <br />
        Bundesagentur für Arbeit — Agentur für Arbeit Düsseldorf
        <br />
        40180 Düsseldorf
      </p>

      <h2>Redaktionell verantwortlich (§ 18 Abs. 2 MStV)</h2>
      <p>
        {companyConfig.ceo}
        <br />
        {companyConfig.street}, {companyConfig.city}
      </p>

      <h2>EU-Streitschlichtung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur
        Online-Streitbeilegung (OS) bereit:{" "}
        <a href="https://ec.europa.eu/consumers/odr/">
          https://ec.europa.eu/consumers/odr/
        </a>
        . Unsere E-Mail-Adresse finden Sie oben im Impressum.
      </p>

      <h2>Verbraucherstreitbeilegung / Universalschlichtungsstelle</h2>
      <p>
        Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor
        einer Verbraucherschlichtungsstelle teilzunehmen.
      </p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf
        diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach den
        §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet,
        übermittelte oder gespeicherte fremde Informationen zu überwachen oder
        nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit
        hinweisen.
      </p>

      <h2>Haftung für Links</h2>
      <p>
        Unser Angebot enthält Links zu externen Websites Dritter, auf deren
        Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden
        Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten
        Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten
        verantwortlich.
      </p>
    </LegalShell>
  );
}
