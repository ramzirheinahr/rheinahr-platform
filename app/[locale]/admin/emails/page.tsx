import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import type { Locale } from "@/i18n/routing";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { EmailLogTable } from "@/components/admin/email-log-table";
import { SendTestEmailDialog } from "@/components/admin/send-test-email-dialog";
import type { OutgoingEmailItem } from "@/components/admin/email-preview-modal";

export const dynamic = "force-dynamic";

export default async function AdminEmailsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireRole(locale as Locale, "admin");
  const t = await getTranslations("emails");

  const emails = await prisma.outgoingEmail.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const total = emails.length;
  const sentCount = emails.filter((e) => e.status === "sent").length;
  const failedCount = emails.filter((e) => e.status === "failed").length;
  const skippedCount = emails.filter((e) => e.status === "skipped_preference").length;

  const rows: OutgoingEmailItem[] = emails.map((e) => ({
    id: e.id,
    to: e.to,
    recipientName: e.recipientName,
    userId: e.userId,
    subject: e.subject,
    body: e.body,
    html: e.html,
    status: e.status as "sent" | "failed" | "skipped_preference",
    error: e.error,
    attachments: e.attachments as any,
    sentAt: e.sentAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Mail className="size-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("title")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <SendTestEmailDialog defaultEmail={user.email} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Mail className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{t("kpiTotal")}</p>
              <p className="text-2xl font-bold">{total}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{t("statusSent")}</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{sentCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-destructive/20 bg-destructive/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/15 text-destructive">
              <XCircle className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{t("statusFailed")}</p>
              <p className="text-2xl font-bold text-destructive">{failedCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{t("statusSkipped")}</p>
              <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{skippedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card className="shadow-xs">
        <CardContent className="p-4 sm:p-6">
          <EmailLogTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
