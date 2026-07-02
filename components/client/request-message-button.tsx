"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
import { sendRequestMessage } from "@/app/[locale]/client/orders/actions";
import { MessageSquare, Send } from "lucide-react";

// Shown in place of the edit button once a request is locked (< 4h before the
// first shift): the client sends a change request that reaches every admin.
export function RequestMessageButton({ requestGroupId }: { requestGroupId: string }) {
  const t = useTranslations("orders");
  const c = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function send() {
    const text = body.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await sendRequestMessage(requestGroupId, text);
      if (res.ok) {
        toast.success(t("messageSent"));
        setBody("");
        setOpen(false);
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <MessageSquare className="size-4" />
        {t("requestChange")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("messageTitle")}</DialogTitle>
          <DialogDescription>{t("messageHint")}</DialogDescription>
        </DialogHeader>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={1000}
          placeholder={t("messagePlaceholder")}
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {c("cancel")}
          </DialogClose>
          <Button onClick={send} disabled={pending || !body.trim()} className="gap-2">
            <Send className="size-4" />
            {pending ? c("loading") : t("messageSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
