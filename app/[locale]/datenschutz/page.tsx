import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Datenschutzerklärung — RheinAhr Dienstleistungen GmbH",
};

export default async function DatenschutzPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <LegalShell title="Datenschutzerklärung">
      <p>
        Wir freuen uns über Ihr Interesse an unserer Plattform. Der Schutz Ihrer
        personenbezogenen Daten ist uns ein wichtiges Anliegen. Nachfolgend
        informieren wir Sie gemäß der Datenschutz-Grundverordnung (DSGVO) über
        die Verarbeitung Ihrer Daten.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        Verantwortlich im Sinne der DSGVO ist:
        <br />
        RheinAhr Dienstleistungen GmbH
        <br />
        Theaterplatz 1, 53177 Bonn, Deutschland
        <br />
        Geschäftsführer: Basem Aldanaf
        <br />
        E-Mail: <a href="mailto:info@rheinahr-gmbh.de">info@rheinahr-gmbh.de</a>
        <br />
        Telefon: 0228 / 28 68 3821
      </p>

      <h2>2. Allgemeines zur Datenverarbeitung</h2>
      <p>
        Wir verarbeiten personenbezogene Daten nur, soweit dies zur
        Bereitstellung der Plattform sowie zur Erfüllung unserer Aufgaben als
        Personaldienstleister erforderlich ist. Rechtsgrundlagen sind
        insbesondere Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung und
        vorvertragliche Maßnahmen), lit. c DSGVO (rechtliche Verpflichtungen,
        u. a. nach dem AÜG) sowie lit. f DSGVO (berechtigte Interessen).
      </p>

      <h2>3. Hosting und Datenspeicherung</h2>
      <p>
        Unsere Anwendung wird bei Anbietern mit Serverstandort innerhalb der
        Europäischen Union betrieben. Datenbank, Authentifizierung und
        Dateispeicher werden über Supabase (EU-Region) bereitgestellt; das
        Hosting der Anwendung erfolgt über Vercel (EU). Mit diesen Anbietern
        bestehen Verträge zur Auftragsverarbeitung gemäß Art. 28 DSGVO. Eine
        Übermittlung in Drittländer findet ohne geeignete Garantien nicht statt.
      </p>

      <h2>4. Welche Daten wir verarbeiten</h2>
      <p>
        Je nach Rolle verarbeiten wir insbesondere: Anmelde- und Kontaktdaten
        (E-Mail, Name), bei Fachkräften Qualifikationen, Zertifikate,
        Vertragsart, Verfügbarkeiten und Einsatzhistorie, bei Einrichtungen
        Stamm- und Ansprechpartnerdaten sowie Auftrags- und Einsatzdaten. Für
        den digitalen Leistungsnachweis werden Bestätigungsdaten einschließlich
        elektronischer Unterschrift bzw. hochgeladener Dokumente, geleisteter
        Stunden, Zeitstempel und IP-Adresse gespeichert (Art. 6 Abs. 1 lit. b
        und f DSGVO; Nachweis- und Abrechnungszwecke).
      </p>

      <h2>5. Zwecke der Verarbeitung</h2>
      <p>
        Die Verarbeitung dient der Vermittlung und Überlassung qualifizierter
        Pflege- und Fachkräfte, der Koordination von Einsätzen, der
        rechtssicheren Leistungsdokumentation sowie der Erfüllung gesetzlicher
        Aufbewahrungs- und Nachweispflichten.
      </p>

      <h2>6. Empfänger und Auftragsverarbeiter</h2>
      <p>
        Eine Weitergabe Ihrer Daten erfolgt ausschließlich an die zur
        Einsatzdurchführung beteiligten Stellen (z. B. die anfragende
        Einrichtung bzw. die zugewiesene Fachkraft) sowie an technische
        Dienstleister im Rahmen der Auftragsverarbeitung. Eine darüber
        hinausgehende Weitergabe erfolgt nur, sofern eine gesetzliche
        Verpflichtung besteht.
      </p>

      <h2>7. Speicherdauer</h2>
      <p>
        Wir speichern personenbezogene Daten nur so lange, wie dies für die
        genannten Zwecke erforderlich ist oder gesetzliche Aufbewahrungsfristen
        (z. B. handels- und steuerrechtliche Fristen) dies vorschreiben. Danach
        werden die Daten gelöscht.
      </p>

      <h2>8. Ihre Rechte als betroffene Person</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16),
        Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
        Datenübertragbarkeit (Art. 20) sowie ein Widerspruchsrecht (Art. 21).
        Zur Ausübung genügt eine Nachricht an{" "}
        <a href="mailto:info@rheinahr-gmbh.de">info@rheinahr-gmbh.de</a>.
      </p>

      <h2>9. Beschwerderecht bei der Aufsichtsbehörde</h2>
      <p>
        Ihnen steht ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde
        zu (Art. 77 DSGVO). Zuständig ist:
        <br />
        Landesbeauftragte für Datenschutz und Informationsfreiheit
        Nordrhein-Westfalen (LDI NRW)
        <br />
        Kavalleriestraße 2–4, 40213 Düsseldorf
      </p>

      <h2>10. Cookies und Sitzungen</h2>
      <p>
        Wir verwenden ausschließlich technisch notwendige Cookies, die für die
        Anmeldung und den Betrieb der Plattform erforderlich sind (z. B. zur
        Aufrechterhaltung Ihrer Sitzung). Eine Einwilligung ist hierfür nach
        § 25 Abs. 2 TDDDG nicht erforderlich. Es findet kein Tracking zu
        Werbezwecken statt.
      </p>

      <h2>11. Datensicherheit</h2>
      <p>
        Wir treffen technische und organisatorische Maßnahmen, um Ihre Daten
        gegen unbefugten Zugriff zu schützen, u. a. Transportverschlüsselung
        (TLS), rollenbasierte Zugriffskontrolle und Protokollierung sicherheits-
        und datenschutzrelevanter Zugriffe.
      </p>

      <p className="!mt-10 text-xs text-muted-foreground">Stand: Juni 2026</p>
    </LegalShell>
  );
}
