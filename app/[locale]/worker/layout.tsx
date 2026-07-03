import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import type { Locale } from "@/i18n/routing";

// Auth-gated: must run per-request (reads the session cookie), never prerendered.
export const dynamic = "force-dynamic";

export default async function WorkerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(locale as Locale, "worker");
  const t = await getTranslations("portal");

  const nav = [
    { href: "/worker", label: t("schedule") },
    { href: "/worker/inbox", label: t("inbox") },
    { href: "/worker/documents", label: t("documents") },
  ];

  return (
    <PortalShell
      title={t("workerTitle")}
      email={user.email}
      userId={user.id}
      role={user.role}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
