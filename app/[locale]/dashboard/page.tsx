import { redirect } from "@/i18n/navigation";
import { getCurrentUser, portalPath } from "@/lib/auth";
import type { Locale } from "@/i18n/routing";

// Post-login hop: resolves the signed-in user's role and forwards them to the
// correct portal (admin / client / worker). Never rendered.
export const dynamic = "force-dynamic";

export default async function DashboardRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getCurrentUser();
  if (!user) redirect({ href: "/login", locale });
  redirect({ href: portalPath(user!.role), locale: locale as Locale });
}
