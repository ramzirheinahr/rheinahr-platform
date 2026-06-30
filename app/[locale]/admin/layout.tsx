import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { PortalShell } from "@/components/portal/portal-shell";
import type { Locale } from "@/i18n/routing";

// Auth-gated: must run per-request (reads the session cookie), never prerendered.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireRole(locale as Locale, "admin");
  const t = await getTranslations("portal");
  const ta = await getTranslations("accounts");
  const tr = await getTranslations("reports");
  const ti = await getTranslations("invoicing");

  const nav = [
    { href: "/admin", label: t("dashboard") },
    { href: "/admin/orders", label: t("orders") },
    { href: "/admin/workers", label: t("workers") },
    { href: "/admin/clients", label: t("clients") },
    { href: "/admin/reports", label: tr("title") },
    { href: "/admin/invoicing", label: ti("title") },
    // Account creation & role assignment is super_admin-only.
    ...(user.role === "super_admin"
      ? [{ href: "/admin/accounts", label: ta("title") }]
      : []),
  ];

  return (
    <PortalShell title={t("adminTitle")} email={user.email} userId={user.id} nav={nav}>
      {children}
    </PortalShell>
  );
}
