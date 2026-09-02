import { requireRole } from "@/lib/auth";
import { setRequestLocale } from "next-intl/server";
import { getSystemSettings } from "./actions";
import { SystemSettingsForm } from "@/components/admin/system-settings-form";
import { CompanySettingsForm } from "@/components/admin/company-settings-form";

export default async function SystemSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale as any, "super_admin", "admin");

  const settings = await getSystemSettings();

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage dynamic assets and content for the landing page, as well as core company configuration.
        </p>
      </div>
      
      <div className="max-w-4xl mt-8 space-y-12">
        <CompanySettingsForm settings={settings} />
        <SystemSettingsForm settings={settings} />
      </div>
    </div>
  );
}
