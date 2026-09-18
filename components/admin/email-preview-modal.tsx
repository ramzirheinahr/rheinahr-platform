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
  Copy,
  Check,
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
  const [copied, setCopied] = useState(false);

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

  function handleCopyId() {
    if (!email) return;
    navigator.clipboard.writeText(email.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const statusBadge = () => {
    switch (email.status) {
      case "sent":
        return (
          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1.5 px-2.5 py-1 text-xs shadow-xs">
            <CheckCircle2 className="size-3.5" />
            <span>{t("statusSent")}</span>
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1.5 px-2.5 py-1 text-xs shadow-xs">
            <XCircle className="size-3.5" />
            <span>{t("statusFailed")}</span>
          </Badge>
        );
      case "skipped_preference":
        return (
          <Badge variant="outline" className="border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1.5 px-2.5 py-1 text-xs shadow-xs">
            <AlertTriangle className="size-3.5" />
            <span>{t("statusSkipped")}</span>
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

  const previewHtml = email.html
    ? email.html
    : `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 15px;
            line-height: 1.6;
            color: #222;
            padding: 24px;
            margin: 0;
          }
        </style>
      </head>
      <body>
        ${email.body.replace(/\n/g, "<br>")}
      </body>
      </html>
    `;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl md:max-w-5xl lg:max-w-6xl w-[95vw] h-[90vh] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl rounded-2xl border bg-background">
        {/* Header */}
        <DialogHeader className="p-5 sm:p-6 pb-4 border-b bg-muted/20 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Mail className="size-5" />
              </div>
              <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight truncate">
                {t("modalTitle")}
              </DialogTitle>
            </div>
            <div className="me-6 sm:me-8">{statusBadge()}</div>
          </div>
          <DialogDescription className="sr-only">
            {email.subject}
          </DialogDescription>

          {/* Metadata Card */}
          <div className="mt-4 rounded-xl border bg-card p-3.5 sm:p-4 text-sm shadow-2xs space-y-2.5">
            {/* Subject */}
            <div className="flex items-start gap-2.5">
              <span className="text-muted-foreground font-medium shrink-0 min-w-16">
                {t("subject")}:
              </span>
              <span className="font-bold text-foreground text-base tracking-tight break-words">
                {email.subject}
              </span>
            </div>

            {/* Recipient & Date in responsive row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t">
              <div className="flex items-center gap-2 text-foreground min-w-0">
                <User className="size-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground font-medium shrink-0">
                  {t("recipient")}:
                </span>
                <span className="font-semibold truncate">
                  {email.recipientName || email.to}
                </span>
                {email.recipientName && (
                  <Badge variant="secondary" className="font-mono text-xs truncate max-w-[180px]">
                    {email.to}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="size-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground font-medium shrink-0">
                  {t("date")}:
                </span>
                <span className="font-medium text-foreground">{formattedDate}</span>
              </div>
            </div>
          </div>

          {/* Error Notice */}
          {email.error && (
            <div className="mt-3 p-3 text-sm bg-destructive/10 text-destructive border border-destructive/20 rounded-lg flex items-start gap-2.5">
              <AlertTriangle className="size-4.5 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-xs uppercase tracking-wider">
                  {t("errorNotice")}
                </p>
                <div className="mt-1 p-2 rounded bg-background/60 font-mono text-xs border border-destructive/20 break-all overflow-x-auto text-foreground">
                  {email.error}
                </div>
              </div>
            </div>
          )}

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Paperclip className="size-3.5" />
                {t("attachments")}:
              </span>
              {email.attachments.map((att, i) => (
                <Badge key={i} variant="outline" className="gap-1.5 text-xs py-1 px-2.5 bg-muted/40">
                  <span className="font-medium">{att.filename}</span>
                  {att.size && (
                    <span className="text-muted-foreground font-mono text-[11px]">
                      ({Math.round(att.size / 1024)} KB)
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        {/* Content Tabs & Isolated Iframe */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden min-h-0 bg-muted/10">
          <Tabs defaultValue="html" className="w-full h-full flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2.5 shrink-0">
              <TabsList className="bg-muted">
                <TabsTrigger value="html" className="px-3 py-1.5 text-xs font-medium">
                  {t("htmlView")}
                </TabsTrigger>
                <TabsTrigger value="text" className="px-3 py-1.5 text-xs font-medium">
                  {t("textView")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="html" className="flex-1 min-h-0 m-0 overflow-hidden">
              <div className="w-full h-full rounded-xl border border-border/70 bg-white overflow-hidden shadow-xs">
                <iframe
                  title="Email Preview"
                  srcDoc={previewHtml}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-same-origin"
                />
              </div>
            </TabsContent>

            <TabsContent value="text" className="flex-1 min-h-0 m-0 overflow-hidden">
              <div className="w-full h-full p-4 rounded-xl border bg-muted/30 font-mono text-sm whitespace-pre-wrap overflow-y-auto leading-relaxed">
                {email.body}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <DialogFooter className="p-3.5 sm:p-4 border-t bg-muted/20 shrink-0 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline font-medium">ID:</span>
            <span className="font-mono text-[11px] truncate max-w-[120px] sm:max-w-[200px]" title={email.id}>
              {email.id}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopyId}
              title="Copy ID"
              aria-label="Copy ID"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResend}
              disabled={resending}
              className="gap-1.5 text-xs h-9"
            >
              <RotateCw className={`size-3.5 ${resending ? "animate-spin" : ""}`} />
              <span>{t("resendButton")}</span>
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-9 min-w-20"
            >
              {c("close")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
