import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Zap, Rocket } from "lucide-react";

export const metadata: Metadata = {
  title: "Funktionen & Roadmap — RheinAhr",
};

type Section = {
  icon: typeof CheckCircle2;
  badge: string;
  badgeClass: string;
  title: string;
  subtitle: string;
  groups: { heading?: string; items: string[] }[];
};

const sections: Section[] = [
  {
    icon: CheckCircle2,
    badge: "Live",
    badgeClass: "bg-primary/10 text-primary ring-primary/20",
    title: "Jetzt verfügbar",
    subtitle: "Bereits einsatzbereit auf der Plattform.",
    groups: [
      {
        items: [
          "Mehrsprachig (Deutsch / Englisch / Arabisch) inkl. arabischem RTL-Layout",
          "Rollen & Rechte: Super-Admin, Verwaltung, Einrichtung, Pflegekraft",
          "Kontenverwaltung & Rollenvergabe durch den Super-Admin",
          "Verwaltung von Pflegekräften & Einrichtungen",
          "Auftragslebenszyklus mit automatischem Matching (Qualifikation + Verfügbarkeit)",
          "Zuweisung & Einsatzannahme durch die Pflegekraft",
          "Digitaler Leistungsnachweis: elektronische Unterschrift + Dokument-Upload (mit Zeitstempel & IP)",
          "Verfügbarkeitskalender der Pflegekräfte",
          "In-App-Benachrichtigungen & interne Nachrichten je Einsatz",
          "Berichte (Erfüllungsquote, Auslastung, Stunden)",
          "Abrechnungsexport CSV / DATEV + Leistungsnachweis als PDF",
          "Installierbare Mobile-App (PWA) · DSGVO-konform (EU-Hosting, Impressum, Datenschutz, Datenexport)",
        ],
      },
    ],
  },
  {
    icon: Zap,
    badge: "Kurzfristig",
    badgeClass: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
    title: "Kurzfristig aktivierbar",
    subtitle: "Technisch vorbereitet — auf Wunsch zuschaltbar.",
    groups: [
      {
        items: [
          "Automatische Erinnerungen 24 h und 1 h vor dem Einsatz (E-Mail / SMS / WhatsApp)",
          "Push-Benachrichtigungen aufs Handy (ohne SMS-Kosten)",
          "Zwei-Faktor-Authentifizierung (Pflicht für die Verwaltung)",
        ],
      },
    ],
  },
  {
    icon: Rocket,
    badge: "Roadmap",
    badgeClass: "bg-blue-500/10 text-blue-600 ring-blue-500/20",
    title: "Geplante Ausbaustufen",
    subtitle: "Nach Ihren Prioritäten umsetzbar.",
    groups: [
      {
        heading: "Compliance Altenpflege",
        items: [
          "Ablaufüberwachung von Nachweisen (Masernschutz, Führungszeugnis, Erste-Hilfe …) mit Vorwarnung",
          "AÜG-Höchstüberlassungsdauer (18 Monate) & Equal-Pay-Überwachung",
          "Dokumenten-Tresor mit Verifizierung",
        ],
      },
      {
        heading: "Disposition",
        items: [
          "Wochen-/Monats-Kalenderansicht für die Verwaltung",
          "Wiederkehrende Schichten & Vorlagen",
          "Intelligente Matching-Reihenfolge (Nähe, Zuverlässigkeit, Präferenzen)",
        ],
      },
      {
        heading: "Einsatz vor Ort",
        items: [
          "Check-in / Check-out per Handy (Zeit & Ort)",
          "Gegenseitige Bewertungen (Einrichtung ↔ Pflegekraft)",
        ],
      },
      {
        heading: "Finanzen",
        items: [
          "Rechnungserstellung als PDF aus bestätigten Stunden",
          "Lohn-Export & tiefere DATEV-Integration",
          "Tarif- & Margenverwaltung (Verrechnungssatz vs. Lohn)",
        ],
      },
      {
        heading: "Skalierung & Integrationen",
        items: [
          "Mehrere Standorte / Mandanten & feinere Berechtigungen",
          "Qualifizierte elektronische Signatur (QES / BundID)",
          "WhatsApp Business & Kalender-Synchronisierung",
        ],
      },
    ],
  },
];

export default async function RoadmapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH">
          <Logo className="h-9 w-auto" priority />
        </Link>
        <Button variant="ghost" size="sm" className="gap-2" render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
          Zurück
        </Button>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Funktionen & Roadmap</h1>
        <p className="mt-3 max-w-2xl text-pretty text-muted-foreground">
          Die RheinAhr-Plattform digitalisiert die Personaldisposition in der
          Altenpflege — von der Anfrage über das Matching bis zum rechtssicheren
          Leistungsnachweis. Diese Übersicht zeigt, was heute verfügbar ist und
          welche Ausbaustufen geplant sind.
        </p>

        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <section key={s.title}>
              <div className="flex items-center gap-3">
                <s.icon className="size-5 text-foreground" />
                <h2 className="text-xl font-semibold">{s.title}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${s.badgeClass}`}
                >
                  {s.badge}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{s.subtitle}</p>

              <div className="mt-4 space-y-5">
                {s.groups.map((g, gi) => (
                  <div key={gi}>
                    {g.heading ? (
                      <h3 className="mb-2 text-sm font-semibold text-foreground/80">
                        {g.heading}
                      </h3>
                    ) : null}
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {g.items.map((item, ii) => (
                        <li
                          key={ii}
                          className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm"
                        >
                          <s.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-12 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          Reihenfolge und Priorität der Ausbaustufen richten sich nach Ihren
          Anforderungen. — RheinAhr Dienstleistungen GmbH
        </p>
      </main>
    </div>
  );
}
