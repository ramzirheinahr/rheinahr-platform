"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  Paperclip,
  Mail,
  Calendar,
  User,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { resendOutgoingEmail } from "@/app/[locale]/admin/emails/actions";

export type OutgoingEmailItem = {
  id: string;
  to: string;
  recipientName: string | null;
  userId: string | null;
  subject: string;
  body: string;
  html: string | null;
  status: "sent" | "failed" | "skipped_preference";
  error: string | null;
  attachments: { filename: string; contentType?: string; size?: number }[] | null;
  sentAt: string;
  createdAt: string;
};

export function EmailPreviewModal({
  email,
  open,
  onOpenChange,
}: {
  email: OutgoingEmailItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("emails");
  const c = useTranslations("common");
  const [resending, startResend] = useTransition();

  if (!email) return null;

  function handleResend() {
    if (!email) return;
    startResend(async () => {
      const res = await resendOutgoingEmail(email.id);
      if (res.ok) {
        toast.success(t("resendSuccess"));
        onOpenChange(false);
      } else {
        toast.error(res.error ? `${t("resendFailed")}: ${res.error}` : t("resendFailed"));
      }
    });
  }

  const statusBadge = () => {
    switch (email.status) {
      case "sent":
        return (
          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
            <CheckCircle2 className="size-3.5" />
            {t("statusSent")}
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="size-3.5" />
            {t("statusFailed")}
          </Badge>
        );
      case "skipped_preference":
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400 gap-1">
            <AlertTriangle className="size-3.5" />
            {t("statusSkipped")}
          </Badge>
        );
    }
  };

  const formattedDate = new Date(email.sentAt || email.createdAt).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="size-5 text-primary" />
              <DialogTitle className="text-xl font-semibold">{t("modalTitle")}</DialogTitle>
            </div>
            <div>{statusBadge()}</div>
          </div>
          <DialogDescription className="sr-only">
            {email.subject}
          </DialogDescription>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4 text-sm bg-muted/50 p-3 rounded-lg border">
            <div className="flex items-center gap-2 text-foreground">
              <User className="size-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium">{t("recipient")}:</span>
              <span className="truncate font-medium">
                {email.recipientName ? `${email.recipientName} (${email.to})` : email.to}
              </span>
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <Calendar className="size-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium">{t("date")}:</span>
              <span>{formattedDate}</span>
            </div>
            <div className="md:col-span-2 flex items-start gap-2 text-foreground">
              <span className="text-muted-foreground font-medium shrink-0">{t("subject")}:</span>
              <span className="font-semibold">{email.subject}</span>
            </div>
          </div>

          {email.error && (
            <div className="mt-3 p-3 text-sm bg-destructive/10 text-destructive border border-destructive/20 rounded-md flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{t("errorNotice")}</p>
                <p className="text-xs font-mono mt-0.5 break-all">{email.error}</p>
              </div>
            </div>
          )}

          {email.attachments && email.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Paperclip className="size-3.5" />
                {t("attachments")}:
              </span>
              {email.attachments.map((att, i) => (
                <Badge key={i} variant="secondary" className="gap-1 text-xs py-0.5">
                  <span>{att.filename}</span>
                  {att.size && (
                    <span className="text-muted-foreground">({Math.round(att.size / 1024)} KB)</span>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-4">
          <Tabs defaultValue="html" className="w-full h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <TabsList>
                <TabsTrigger value="html">{t("htmlView")}</TabsTrigger>
                <TabsTrigger value="text">{t("textView")}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="html" className="flex-1 min-h-[420px] m-0">
              <div className="w-full h-[450px] rounded-md border bg-white overflow-hidden shadow-sm">
                <iframe
                  title="Email Preview"
                  srcDoc={email.html || `<div style="font-family: sans-serif; padding: 20px;">${email.body.replace(/\n/g, "<br>")}</div>`}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-same-origin"
                />
              </div>
            </TabsContent>

            <TabsContent value="text" className="flex-1 m-0">
              <div className="w-full h-[450px] p-4 rounded-md border bg-muted/30 font-mono text-sm whitespace-pre-wrap overflow-y-auto">
                {email.body}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 flex sm:justify-between items-center">
          <div className="text-xs text-muted-foreground hidden sm:block">
            ID: <span className="font-mono">{email.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleResend}
              disabled={resending}
              className="gap-1.5"
            >
              <RotateCw className={`size-4 ${resending ? "animate-spin" : ""}`} />
              {t("resendButton")}
            </Button>
            <Button variant="default" onClick={() => onOpenChange(false)}>
              {c("close")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
