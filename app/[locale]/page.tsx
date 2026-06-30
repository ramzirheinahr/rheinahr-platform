import { setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";
import { CalendarCheck, FileSignature, BellRing } from "lucide-react";

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

  const features = [
    { icon: CalendarCheck, title: t("feature1Title"), body: t("feature1Body") },
    { icon: FileSignature, title: t("feature2Title"), body: t("feature2Body") },
    { icon: BellRing, title: t("feature3Title"), body: t("feature3Body") },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="flex flex-col gap-1">
          <Logo className="h-10 w-auto" priority />
          <span className="hidden text-xs text-muted-foreground ps-1 sm:block">
            {c("tagline")}
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button render={<Link href="/login" />} size="sm">
            {c("login")}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h1 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            {t("heroTitle")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            {t("heroSubtitle")}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button render={<Link href="/login" />} size="lg">
              {t("ctaClient")}
            </Button>
            <Button render={<Link href="/login" />} size="lg" variant="outline">
              {t("ctaWorker")}
            </Button>
          </div>
        </section>

        <section className="border-t bg-muted/30 py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-2xl font-semibold">
              {t("featuresTitle")}
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {features.map((feat) => (
                <div
                  key={feat.title}
                  className="rounded-lg border bg-background p-6 text-start"
                >
                  <feat.icon className="size-8 text-primary" />
                  <h3 className="mt-4 font-semibold">{feat.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{feat.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-6 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <span>
            © RheinAhr Dienstleistungen GmbH — {f("rights")}
          </span>
          <nav className="flex gap-4">
            <Link href="/impressum" className="hover:text-foreground">
              {f("imprint")}
            </Link>
            <Link href="/datenschutz" className="hover:text-foreground">
              {f("privacy")}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
