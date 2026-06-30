import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import { qualifications } from "@/lib/validations";
import {
  ShieldCheck,
  Lock,
  Server,
  HeartPulse,
  ClipboardList,
  Sparkles,
  FileSignature,
  Zap,
  BellRing,
  Languages,
  Smartphone,
  Building2,
  UserPlus,
  Phone,
  Mail,
  MapPin,
  ArrowRight,
} from "lucide-react";

const COMPANY = {
  phone: "0228 / 28 68 3821",
  tel: "+4922828683821",
  email: "info@rheinahr-gmbh.de",
  address: "Fronhof 4, 53177 Bonn",
};

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <Landing />;
}

function Landing() {
  const t = useTranslations("landing");
  const c = useTranslations("common");
  const f = useTranslations("footer");
  const eq = useTranslations("enums.qualification");

  const stats = [
    { value: "200+", label: t("stats.workers") },
    { value: "50+", label: t("stats.facilities") },
    { value: "3", label: t("stats.languages") },
    { value: "< 5 Min", label: t("stats.response") },
  ];

  const steps = [
    { icon: ClipboardList, title: t("how.step1Title"), body: t("how.step1Body") },
    { icon: Sparkles, title: t("how.step2Title"), body: t("how.step2Body") },
    { icon: FileSignature, title: t("how.step3Title"), body: t("how.step3Body") },
  ];

  const features = [
    { icon: Zap, title: t("why.f1Title"), body: t("why.f1Body") },
    { icon: ShieldCheck, title: t("why.f2Title"), body: t("why.f2Body") },
    { icon: BellRing, title: t("why.f3Title"), body: t("why.f3Body") },
    { icon: Languages, title: t("why.f4Title"), body: t("why.f4Body") },
    { icon: Lock, title: t("why.f5Title"), body: t("why.f5Body") },
    { icon: Smartphone, title: t("why.f6Title"), body: t("why.f6Body") },
  ];

  const trust = [
    { icon: ShieldCheck, label: t("trust.aug") },
    { icon: Lock, label: t("trust.dsgvo") },
    { icon: Server, label: t("trust.eu") },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH">
            <Logo className="h-9 w-auto" priority />
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#services" className="hover:text-foreground">{t("nav.services")}</a>
            <a href="#how" className="hover:text-foreground">{t("nav.how")}</a>
            <a href="#why" className="hover:text-foreground">{t("nav.why")}</a>
            <a href="#contact" className="hover:text-foreground">{t("nav.contact")}</a>
          </nav>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Button render={<Link href="/login" />} size="sm">
              {c("login")}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-b from-primary/5 to-background">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
            <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <HeartPulse className="size-3.5 text-primary" />
              {t("hero.badge")}
            </span>
            <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
              {t("hero.title")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
              {t("hero.subtitle")}
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button render={<Link href="/login" />} size="lg" className="gap-2">
                {t("hero.ctaClient")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
              <Button render={<Link href="/login" />} size="lg" variant="outline">
                {t("hero.ctaWorker")}
              </Button>
            </div>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {trust.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1.5">
                  <item.icon className="size-4 text-primary" />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y bg-muted/30">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-bold text-primary">{s.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Services / qualifications */}
        <section id="services" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t("services.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("services.subtitle")}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {qualifications.map((q) => (
              <div
                key={q}
                className="flex items-center gap-3 rounded-xl border bg-card p-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <HeartPulse className="size-5" />
                </span>
                <span className="font-medium">{eq(q)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">{t("how.title")}</h2>
              <p className="mt-3 text-muted-foreground">{t("how.subtitle")}</p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((step, i) => (
                <div key={step.title} className="relative text-center">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <step.icon className="size-6" />
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <span className="text-sm font-bold text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-semibold">{step.title}</h3>
                  </div>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Why us */}
        <section id="why" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t("why.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("why.subtitle")}</p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feat) => (
              <div key={feat.title} className="rounded-xl border bg-card p-6">
                <feat.icon className="size-8 text-primary" />
                <h3 className="mt-4 font-semibold">{feat.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feat.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Audience split */}
        <section className="border-y bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-2">
            <div className="rounded-2xl border bg-card p-8">
              <Building2 className="size-9 text-primary" />
              <h3 className="mt-4 text-xl font-semibold">{t("audience.facilitiesTitle")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("audience.facilitiesBody")}</p>
              <Button render={<Link href="/login" />} className="mt-5 gap-2">
                {t("audience.facilitiesCta")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
            <div className="rounded-2xl border bg-card p-8">
              <UserPlus className="size-9 text-primary" />
              <h3 className="mt-4 text-xl font-semibold">{t("audience.workersTitle")}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t("audience.workersBody")}</p>
              <Button render={<Link href="/login" />} variant="outline" className="mt-5 gap-2">
                {t("audience.workersCta")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t("contact.title")}</h2>
            <p className="mt-3 text-muted-foreground">{t("contact.subtitle")}</p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-3">
            <a
              href={`tel:${COMPANY.tel}`}
              className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center hover:border-primary"
            >
              <Phone className="size-6 text-primary" />
              <span className="text-xs text-muted-foreground">{t("contact.phone")}</span>
              <span className="text-sm font-medium">{COMPANY.phone}</span>
            </a>
            <a
              href={`mailto:${COMPANY.email}`}
              className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center hover:border-primary"
            >
              <Mail className="size-6 text-primary" />
              <span className="text-xs text-muted-foreground">{t("contact.email")}</span>
              <span className="text-sm font-medium">{COMPANY.email}</span>
            </a>
            <div className="flex flex-col items-center gap-2 rounded-xl border bg-card p-6 text-center">
              <MapPin className="size-6 text-primary" />
              <span className="text-xs text-muted-foreground">{t("contact.address")}</span>
              <span className="text-sm font-medium">{COMPANY.address}</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Logo className="h-8 w-auto" />
            <p className="text-sm text-muted-foreground">{t("footerTagline")}</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/roadmap" className="hover:text-foreground">Roadmap</Link>
            <Link href="/impressum" className="hover:text-foreground">{f("imprint")}</Link>
            <Link href="/datenschutz" className="hover:text-foreground">{f("privacy")}</Link>
            <Link href="/login" className="hover:text-foreground">{c("login")}</Link>
          </nav>
        </div>
        <div className="border-t py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} RheinAhr Dienstleistungen GmbH — {f("rights")}
        </div>
      </footer>
    </div>
  );
}
