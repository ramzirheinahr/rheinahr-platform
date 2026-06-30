import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import type { Locale } from "@/i18n/routing";

// Auth-gated: must run per-request (reads the session cookie), never prerendered.
export const dynamic = "force-dynamic";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(locale as Locale, "client");
  const t = await getTranslations("portal");

  const nav = [
    { href: "/client", label: t("dashboard") },
    { href: "/client/orders", label: t("orders") },
    { href: "/client/confirmations", label: t("confirmations") },
  ];

  return (
    <PortalShell title={t("clientTitle")} email={user.email} userId={user.id} nav={nav}>
      {children}
    </PortalShell>
  );
}
