import { getTranslations } from "next-intl/server";
import { requireRole } from "@/lib/auth";
import { qualifications } from "@/lib/validations";
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
  const tr = await getTranslations("reports");
  const ti = await getTranslations("invoicing");
  const tw = await getTranslations("workers");
  const eq = await getTranslations("enums.qualification");

  // "Care staff" opens a dropdown: one page per qualification (so each admin can
  // work only their own type) plus an "all types" overview. Accounts are managed
  // inside the worker/client pages (create + edit), so there's no accounts entry.
  const nav = [
    { href: "/admin", label: t("dashboard"), icon: "dashboard" },
    { href: "/admin/inbox", label: t("inbox"), icon: "inbox" },
    { href: "/admin/orders", label: t("orders"), icon: "orders" },
    { href: "/admin/schedule", label: t("masterSchedule"), icon: "schedule" },
    {
      href: "/admin/workers",
      label: t("workers"),
      icon: "workers",
      children: [
        { href: "/admin/workers", label: tw("allTypes") },
        ...qualifications.map((q) => ({
          href: `/admin/workers?qualification=${q}`,
          label: eq(q),
        })),
      ],
    },
    { href: "/admin/clients", label: t("clients"), icon: "clients" },
    { href: "/admin/appointments", label: t("appointments"), icon: "appointments" },
    { href: "/admin/reports", label: tr("title"), icon: "reports" },
    { href: "/admin/invoicing", label: ti("title"), icon: "invoicing" },
  ];

  if (user.role === "super_admin") {
    const tu = await getTranslations("users");
    nav.push({ href: "/admin/users", label: tu("title"), icon: "users" as any });
  }

  return (
    <PortalShell
      title={t("adminTitle")}
      email={user.email}
      userId={user.id}
      role={user.role}
      nav={nav}
    >
      {children}
    </PortalShell>
  );
}
