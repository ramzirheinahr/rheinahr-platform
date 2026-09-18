"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  saveEmailSettings,
  testSmtpConnection,
} from "@/app/[locale]/admin/settings/system/actions";
import { Mail, KeyRound, Server, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export function EmailSettingsForm({
  settings,
  defaultEnvConfig,
}: {
  settings: Record<string, string>;
  defaultEnvConfig?: { host?: string; port?: number; user?: string; from?: string; hasEnv: boolean };
}) {
  const t = useTranslations("emails");
  const c = useTranslations("common");

  const hasDbConfig = Boolean(
    settings["email.smtp_host"] && settings["email.smtp_user"] && settings["email.smtp_password"]
  );

  const [host, setHost] = useState(settings["email.smtp_host"] || defaultEnvConfig?.host || "");
  const [port, setPort] = useState(
    settings["email.smtp_port"] || (defaultEnvConfig?.port ? String(defaultEnvConfig.port) : "465")
  );
  const [user, setUser] = useState(settings["email.smtp_user"] || defaultEnvConfig?.user || "");
  const [from, setFrom] = useState(settings["email.from"] || defaultEnvConfig?.from || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();

  const hasStoredPassword = Boolean(settings["email.smtp_password"]);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!host || !user) {
      toast.error(t("settingsHostUserRequired"));
      return;
    }
    if (!hasStoredPassword && !password) {
      toast.error(t("settingsPasswordRequired"));
      return;
    }

    startSaving(async () => {
      try {
        await saveEmailSettings({
          host,
          port,
          user,
          from,
          password: password || undefined,
        });
        setPassword("");
        toast.success(t("settingsSaveSuccess"));
      } catch (err: any) {
        toast.error(`${t("settingsSaveFailed")}: ${err.message}`);
      }
    });
  }

  function handleTestConnection() {
    startTesting(async () => {
      try {
        const res = await testSmtpConnection({
          host: host || undefined,
          port: port || undefined,
          user: user || undefined,
          password: password || undefined,
        });
        if (res.ok) {
          toast.success(t("smtpTestSuccess"));
        } else {
          toast.error(`${t("smtpTestFailed")}: ${res.error}`);
        }
      } catch (err: any) {
        toast.error(`${t("smtpTestFailed")}: ${err.message}`);
      }
    });
  }

  return (
    <Card id="email-settings">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail className="size-5 text-primary" />
            <CardTitle>{t("emailSettingsTitle")}</CardTitle>
          </div>
          <div>
            {hasDbConfig ? (
              <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
                <CheckCircle2 className="size-3.5" />
                {t("sourceDatabase")}
              </Badge>
            ) : defaultEnvConfig?.hasEnv ? (
              <Badge variant="outline" className="border-amber-500 text-amber-600 gap-1">
                <AlertCircle className="size-3.5" />
                {t("sourceEnvironment")}
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3.5" />
                {t("sourceNotConfigured")}
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>{t("emailSettingsDesc")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="smtp_host" className="flex items-center gap-1.5">
                <Server className="size-3.5 text-muted-foreground" />
                {t("smtpHostLabel")}
              </Label>
              <Input
                id="smtp_host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="mail.example.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="smtp_port">{t("smtpPortLabel")}</Label>
              <Input
                id="smtp_port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="465"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="smtp_user">{t("smtpUserLabel")}</Label>
              <Input
                id="smtp_user"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="info@example.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email_from">{t("emailFromLabel")}</Label>
              <Input
                id="email_from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Firma Name <info@example.com>"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smtp_password" className="flex items-center gap-1.5">
              <KeyRound className="size-3.5 text-muted-foreground" />
              {t("smtpPasswordLabel")}
            </Label>
            <div className="relative">
              <Input
                id="smtp_password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  hasStoredPassword
                    ? t("passwordKeptPlaceholder")
                    : t("passwordEnterPlaceholder")
                }
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("passwordEncryptedNotice")}
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || saving}
              className="gap-1.5"
            >
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Server className="size-4" />}
              {t("testConnectionButton")}
            </Button>

            <Button type="submit" disabled={saving || testing} className="gap-1.5">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {c("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
