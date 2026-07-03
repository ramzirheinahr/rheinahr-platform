"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startConversation } from "@/lib/inbox-actions";
import { PenSquare, Send } from "lucide-react";

// New-message dialog. Agency staff pick one or more recipients (one private
// thread per recipient); clients/workers write straight to the agency team.
export function ComposeButton({
  basePath,
  recipients,
}: {
  basePath: string;
  recipients?: { id: string; name: string; role: "client" | "worker" }[];
}) {
  const t = useTranslations("inbox");
  const c = useTranslations("common");
  const roles = useTranslations("roles");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const options: ComboOption[] | null = recipients
    ? recipients.map((r) => ({
        value: r.id,
        label: `${r.name} · ${roles(r.role)}`,
      }))
    : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = String(form.get("body") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const recipientIds = form.getAll("recipients").map(String);
    if (!body || (options && recipientIds.length === 0)) return;

    startTransition(async () => {
      const res = await startConversation({
        subject: subject || undefined,
        body,
        recipientIds: options ? recipientIds : undefined,
      });
      if (res.ok) {
        toast.success(t("sent"));
        setOpen(false);
        if (res.conversationId) {
          router.push(`${basePath}/inbox/${res.conversationId}`);
        } else {
          router.refresh();
        }
      } else {
        toast.error(t("sendError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <PenSquare className="size-4" />
        {t("compose")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("composeTitle")}</DialogTitle>
          <DialogDescription>
            {options ? t("composeHintAdmin") : t("composeHint")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {options ? (
            <div className="space-y-1.5">
              <Label>{t("recipients")}</Label>
              <Combobox
                options={options}
                name="recipients"
                multiple
                placeholder={t("recipientsPlaceholder")}
                searchPlaceholder={c("search")}
                emptyText={t("noRecipients")}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="inbox-subject">{t("subject")}</Label>
            <Input
              id="inbox-subject"
              name="subject"
              maxLength={140}
              placeholder={t("subjectPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inbox-body">{t("message")}</Label>
            <textarea
              id="inbox-body"
              name="body"
              rows={5}
              required
              maxLength={4000}
              placeholder={t("messagePlaceholder")}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {c("cancel")}
            </DialogClose>
            <Button type="submit" disabled={pending} className="gap-2">
              <Send className="size-4" />
              {pending ? c("loading") : t("send")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
