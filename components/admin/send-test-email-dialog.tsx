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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendTestEmail } from "@/app/[locale]/admin/emails/actions";

export function SendTestEmailDialog({ defaultEmail }: { defaultEmail?: string }) {
  const t = useTranslations("emails");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail || "");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;

    startTransition(async () => {
      const res = await sendTestEmail(email);
      if (res.ok) {
        toast.success(t("testEmailSuccess"));
        setOpen(false);
      } else {
        toast.error(res.error ? `${t("testEmailFailed")}: ${res.error}` : t("testEmailFailed"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Send className="size-4" />
            {t("sendTestButton")}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("sendTestTitle")}</DialogTitle>
            <DialogDescription>{t("sendTestDesc")}</DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-2">
            <Label htmlFor="targetEmail">{t("targetEmailLabel")}</Label>
            <Input
              id="targetEmail"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={pending}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {c("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !email} className="gap-1.5">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
