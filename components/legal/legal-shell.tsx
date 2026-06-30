import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

// Public chrome for the legal pages. The legal body itself is German (legally
// required); only the surrounding navigation is localized.
export async function LegalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const c = await getTranslations("common");
  const f = await getTranslations("footer");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" aria-label="RheinAhr Dienstleistungen GmbH">
          <Logo className="h-9 w-auto" priority />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <Button variant="ghost" size="sm" className="gap-2" render={<Link href="/" />}>
            <ArrowLeft className="size-4" />
            {c("back")}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">{title}</h1>
        <div className="space-y-6 text-sm leading-relaxed text-foreground/90 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mt-2">
          {children}
        </div>
      </main>

      <footer className="border-t px-6 py-6 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-4">
          <span>© RheinAhr Dienstleistungen GmbH — {f("rights")}</span>
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
