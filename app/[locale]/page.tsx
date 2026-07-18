import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import { qualifications } from "@/lib/validations";
import { ContactForm } from "@/components/landing/contact-form";
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
  MessageCircle,
} from "lucide-react";
import Image from "next/image";

const COMPANY = {
  phone: "0228 / 28 68 3821",
  tel: "+4922828683821",
  whatsapp: "https://wa.me/4915233646562",
  email: "info@rheinahr-gmbh.de",
  address: "Theaterplatz 1, 53177 Bonn",
};

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
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
    <div className="flex min-h-screen flex-col overflow-hidden selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/40">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH" className="transition-transform hover:scale-105">
            <Logo className="h-9 w-auto drop-shadow-sm" priority />
          </Link>
          <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
            <a href="#services" className="text-muted-foreground transition-colors hover:text-primary">{t("nav.services")}</a>
            <a href="#how" className="text-muted-foreground transition-colors hover:text-primary">{t("nav.how")}</a>
            <a href="#why" className="text-muted-foreground transition-colors hover:text-primary">{t("nav.why")}</a>
            <a href="#contact" className="text-muted-foreground transition-colors hover:text-primary">{t("nav.contact")}</a>
          </nav>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <Button render={<Link href="/login" />} size="sm" className="rounded-full shadow-lg shadow-primary/20">
              {c("login")}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden pt-20 pb-32">
          {/* Background Gradients */}
          <div className="absolute inset-0 -z-10 bg-background">
            <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[800px] w-[1200px] opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary via-background to-transparent blur-3xl"></div>
          </div>

          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="max-w-2xl text-center lg:text-left">
                <span className="inline-flex animate-fade-in-up items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary shadow-sm backdrop-blur-sm">
                  <HeartPulse className="size-4 animate-pulse" />
                  {t("hero.badge")}
                </span>
                <h1 className="mt-8 text-balance text-5xl font-extrabold tracking-tight sm:text-6xl xl:text-7xl">
                  {t("hero.title")}
                </h1>
                <p className="mt-6 text-pretty text-lg text-muted-foreground leading-relaxed sm:text-xl">
                  {t("hero.subtitle")}
                </p>
                <div className="mt-10 flex flex-wrap justify-center lg:justify-start gap-4">
                  <Button render={<Link href="/login" />} size="lg" className="rounded-full gap-2 px-8 shadow-xl shadow-primary/25 transition-transform hover:-translate-y-0.5">
                    {t("hero.ctaClient")}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Button>
                  <Button render={<Link href="/login" />} size="lg" variant="outline" className="rounded-full px-8 backdrop-blur-sm border-primary/20 hover:bg-primary/5">
                    {t("hero.ctaWorker")}
                  </Button>
                </div>
                <div className="mt-12 flex flex-wrap items-center justify-center lg:justify-start gap-x-8 gap-y-4 text-sm font-medium text-muted-foreground">
                  {trust.map((item) => (
                    <span key={item.label} className="inline-flex items-center gap-2">
                      <div className="flex size-6 items-center justify-center rounded-full bg-primary/10">
                        <item.icon className="size-3.5 text-primary" />
                      </div>
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
              
              {/* Hero Image Space */}
              <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
                <div className="relative rounded-3xl border border-white/10 bg-muted/20 p-2 shadow-2xl backdrop-blur-3xl overflow-hidden aspect-[4/3] group">
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-secondary/10 opacity-50 z-0"></div>
                  <Image src="/hero_image.png" alt="RheinAhr Care" fill className="object-cover rounded-2xl z-10 transition-transform duration-700 group-hover:scale-105" priority />
                </div>
                {/* Floating Elements for aesthetics */}
                <div className="absolute -left-8 top-1/4 rounded-2xl border bg-background/80 backdrop-blur-md p-4 shadow-xl hidden sm:block animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-green-500/10">
                      <ShieldCheck className="size-5 text-green-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">100% Geprüft</div>
                      <div className="text-xs text-muted-foreground">Qualifiziertes Personal</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 -mt-16 mb-20">
          <div className="rounded-3xl border bg-background/80 p-8 shadow-2xl shadow-black/5 backdrop-blur-xl">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4 divide-x divide-border/50">
              {stats.map((s, i) => (
                <div key={s.label} className={`text-center ${i % 2 === 0 ? "pl-0" : "pl-8"} md:pl-0 border-l-0 ${i !== 0 ? "md:border-l" : ""}`}>
                  <div className="text-4xl font-black tracking-tight text-primary bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/70">{s.value}</div>
                  <div className="mt-2 text-sm font-medium text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Services / qualifications */}
        <section id="services" className="relative py-24 bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <span className="text-sm font-bold tracking-wider text-primary uppercase">{t("services.subtitle")}</span>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{t("services.title")}</h2>
            </div>
            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {qualifications.map((q) => (
                <div key={q} className="group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm transition-all hover:shadow-lg hover:-translate-y-1">
                  <div className="absolute right-0 top-0 -mr-4 -mt-4 size-24 rounded-full bg-primary/5 transition-transform duration-500 group-hover:scale-150"></div>
                  <div className="relative z-10">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 ring-1 ring-primary/20">
                      <HeartPulse className="size-6" />
                    </span>
                    <h3 className="font-semibold text-lg">{eq(q)}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="relative py-24 overflow-hidden">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl -z-10"></div>
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("how.title")}</h2>
                <p className="mt-4 text-lg text-muted-foreground">{t("how.subtitle")}</p>
                <div className="mt-10 space-y-8">
                  {steps.map((step, i) => (
                    <div key={step.title} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
                          <step.icon className="size-5" />
                        </div>
                        {i !== steps.length - 1 && <div className="w-px h-full bg-border mt-4"></div>}
                      </div>
                      <div className="pb-8">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            Schritt {String(i + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <h3 className="mt-2 text-xl font-bold">{step.title}</h3>
                        <p className="mt-2 text-muted-foreground">{step.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Steps Image Space */}
              <div className="relative rounded-3xl border bg-muted/20 p-2 shadow-2xl aspect-square lg:aspect-auto lg:h-[600px] overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-bl from-primary/10 to-transparent z-0"></div>
                <Image src="/facilities_team.png" alt="Our Team" fill className="object-cover rounded-2xl z-10 transition-transform duration-700 group-hover:scale-105" />
              </div>
            </div>
          </div>
        </section>

        {/* Why us */}
        <section id="why" className="relative py-24 bg-primary text-primary-foreground overflow-hidden">
          <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10 mix-blend-overlay"></div>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 relative z-10">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t("why.title")}</h2>
              <p className="mt-4 text-primary-foreground/80 text-lg">{t("why.subtitle")}</p>
            </div>
            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feat) => (
                <div key={feat.title} className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 p-8 backdrop-blur-sm transition-colors hover:bg-primary-foreground/10">
                  <div className="mb-6 inline-flex size-12 items-center justify-center rounded-xl bg-primary-foreground text-primary shadow-sm">
                    <feat.icon className="size-6" />
                  </div>
                  <h3 className="text-xl font-bold">{feat.title}</h3>
                  <p className="mt-3 leading-relaxed text-primary-foreground/70">{feat.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Audience split */}
        <section className="relative py-24 bg-muted/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="group relative overflow-hidden rounded-3xl border bg-card p-10 shadow-lg transition-shadow hover:shadow-xl">
                <div className="absolute right-0 top-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-20 -mt-20 transition-transform group-hover:scale-150"></div>
                <div className="relative z-10">
                  <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-6">
                    <Building2 className="size-7" />
                  </div>
                  <h3 className="text-2xl font-bold">{t("audience.facilitiesTitle")}</h3>
                  <p className="mt-4 text-muted-foreground leading-relaxed">{t("audience.facilitiesBody")}</p>
                  <Button render={<Link href="/login" />} size="lg" className="mt-8 rounded-full gap-2">
                    {t("audience.facilitiesCta")}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Button>
                </div>
              </div>
              <div className="group relative overflow-hidden rounded-3xl border bg-card p-10 shadow-lg transition-shadow hover:shadow-xl">
                <div className="absolute left-0 bottom-0 w-64 h-64 bg-secondary/10 rounded-full blur-3xl -ml-20 -mb-20 transition-transform group-hover:scale-150"></div>
                <div className="relative z-10">
                  <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-border bg-background mb-6 shadow-sm">
                    <UserPlus className="size-7 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold">{t("audience.workersTitle")}</h3>
                  <p className="mt-4 text-muted-foreground leading-relaxed">{t("audience.workersBody")}</p>
                  <Button render={<Link href="/login" />} variant="outline" size="lg" className="mt-8 rounded-full gap-2">
                    {t("audience.workersCta")}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Button>
                </div>
              </div>
            </div>
            
            {/* Workers Image Space */}
            <div className="mt-8 relative rounded-3xl border bg-muted/20 shadow-inner h-64 md:h-96 overflow-hidden group">
              <Image src="/workers_community.png" alt="Community" fill className="object-cover object-[center_15%] transition-transform duration-700 group-hover:scale-105" />
            </div>
          </div>
        </section>

        {/* Contact Form Section */}
        <section id="contact" className="relative py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid lg:grid-cols-2 gap-16">
              {/* Info Column */}
              <div>
                <span className="text-sm font-bold tracking-wider text-primary uppercase">Kontakt</span>
                <h2 className="mt-2 text-4xl font-extrabold tracking-tight">{t("contact.title")}</h2>
                <p className="mt-4 text-lg text-muted-foreground">{t("contact.subtitle")}</p>
                
                <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <a href={`tel:${COMPANY.tel}`} className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Phone className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t("contact.phone")}</p>
                      <p className="font-semibold">{COMPANY.phone}</p>
                    </div>
                  </a>
                  
                  <a href={COMPANY.whatsapp} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-[#25D366] hover:bg-[#25D366]/5">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#25D366]/10 text-[#25D366]">
                      <MessageCircle className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">WhatsApp</p>
                      <p className="font-semibold">Direktnachricht</p>
                    </div>
                  </a>

                  <a href={`mailto:${COMPANY.email}`} className="flex items-center gap-4 rounded-2xl border bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Mail className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t("contact.email")}</p>
                      <p className="font-semibold break-all">{COMPANY.email}</p>
                    </div>
                  </a>

                  <div className="flex items-center gap-4 rounded-2xl border bg-card p-4">
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <MapPin className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">{t("contact.address")}</p>
                      <p className="font-semibold">{COMPANY.address}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Column */}
              <div className="rounded-3xl border bg-card p-8 sm:p-10 shadow-2xl shadow-black/5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-bl-full -mr-4 -mt-4"></div>
                <h3 className="text-2xl font-bold mb-6">Unverbindliche Anfrage</h3>
                <ContactForm />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card text-card-foreground">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4 max-w-sm">
            <Logo className="h-10 w-auto" />
            <p className="text-sm text-muted-foreground leading-relaxed">{t("footerTagline")}</p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:gap-12 lg:grid-cols-3">
            <div className="space-y-3">
              <h4 className="font-semibold text-sm tracking-wider uppercase">Quick Links</h4>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                <a href="#services" className="hover:text-primary transition-colors">Leistungen</a>
                <a href="#how" className="hover:text-primary transition-colors">Ablauf</a>
                <a href="#contact" className="hover:text-primary transition-colors">Kontakt</a>
                <Link href="/roadmap" className="hover:text-primary transition-colors">Roadmap</Link>
              </nav>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold text-sm tracking-wider uppercase">Rechtliches</h4>
              <nav className="flex flex-col gap-2 text-sm text-muted-foreground">
                <Link href="/impressum" className="hover:text-primary transition-colors">{f("imprint")}</Link>
                <Link href="/datenschutz" className="hover:text-primary transition-colors">{f("privacy")}</Link>
                <Link href="/login" className="hover:text-primary transition-colors">{c("login")}</Link>
              </nav>
            </div>
            <div className="space-y-3 col-span-2 lg:col-span-1">
              <h4 className="font-semibold text-sm tracking-wider uppercase">Kontakt</h4>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>{COMPANY.address}</p>
                <p>{COMPANY.phone}</p>
                <p>{COMPANY.email}</p>
                <a href={COMPANY.whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[#25D366] hover:underline font-medium mt-2">
                  <MessageCircle className="size-4" /> WhatsApp Chat
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="border-t bg-muted/30 py-6 text-center text-xs text-muted-foreground">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-2">
            <span>© {new Date().getFullYear()} RheinAhr Dienstleistungen GmbH — {f("rights")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
