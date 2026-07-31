"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Laptop, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { revokeSession } from "@/app/[locale]/admin/clients/actions";

type SessionInfo = {
  id: string;
  device: string | null;
  ipAddress: string | null;
  lastActive: Date;
  createdAt: Date;
};

type SessionUser = {
  id: string;
  fullName: string | null;
  email: string;
  sessions: SessionInfo[];
};

export function ActiveSessionsSection({ users }: { users: SessionUser[] }) {
  const t = useTranslations("clients");
  const c = useTranslations("common");
  const router = useRouter();

  const allSessions = users.flatMap(u => 
    u.sessions.map(s => ({ ...s, userName: u.fullName || u.email }))
  ).sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());

  if (allSessions.length === 0) {
    return null; // Don't show the section if no active sessions
  }

  async function handleRevoke(sessionId: string) {
    if (!confirm(t("confirmRevokeSession"))) return;
    
    const result = await revokeSession(sessionId);
    if (result.ok) {
      toast.success(t("sessionRevoked"));
      router.refresh();
    } else {
      toast.error(t("saveError"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activeSessionsTitle")}</CardTitle>
        <CardDescription>{t("activeSessionsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allSessions.map(session => {
          const isMobile = session.device?.toLowerCase().includes("mobile") || session.device?.toLowerCase().includes("android") || session.device?.toLowerCase().includes("iphone");
          return (
            <div key={session.id} className="flex items-center justify-between p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-muted rounded-md">
                  {isMobile ? <Smartphone className="size-5" /> : <Laptop className="size-5" />}
                </div>
                <div>
                  <div className="font-medium">{session.userName}</div>
                  <div className="text-sm text-muted-foreground line-clamp-1 max-w-[200px] sm:max-w-[400px]">
                    {session.device || "Unknown Device"} · {session.ipAddress}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t("lastActive")}: {new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(session.lastActive))}
                  </div>
                </div>
              </div>
              <Button variant="destructive" size="sm" onClick={() => handleRevoke(session.id)}>
                <Trash2 className="size-4 mr-2" />
                {t("revokeSession")}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
