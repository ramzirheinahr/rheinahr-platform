"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Send } from "lucide-react";
import {
  markConversationRead,
  sendConversationMessage,
} from "@/lib/inbox-actions";
import type { ConversationMessage } from "@/lib/inbox";

// Live-ish thread: refreshes while the tab is visible and moves the viewer's
// read cursor whenever new messages arrive.
const REFRESH_MS = 20_000;

export function ConversationThread({
  conversationId,
  messages,
}: {
  conversationId: string;
  messages: ConversationMessage[];
}) {
  const t = useTranslations("messages");
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Read receipt — on open and again when new messages stream in.
  useEffect(() => {
    void markConversationRead(conversationId);
  }, [conversationId, messages.length]);

  // Poll for replies while the tab is in the foreground.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const res = await sendConversationMessage(conversationId, body);
      if (res.ok) {
        setText("");
        router.refresh();
      } else {
        toast.error(t("saveError"));
      }
    });
  }

  return (
    <div className="flex flex-col rounded-lg border">
      <div
        ref={scrollRef}
        className="flex max-h-[55vh] min-h-40 flex-col gap-2 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn("flex flex-col", m.mine ? "items-end" : "items-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                  m.mine
                    ? "rounded-ee-sm bg-primary text-primary-foreground"
                    : "rounded-es-sm bg-muted text-foreground",
                )}
              >
                {m.body}
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                {m.mine ? t("you") : m.senderName} ·{" "}
                {m.createdAt.slice(0, 16).replace("T", " ")}
              </span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={4000}
          className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="sm" className="gap-1.5" disabled={pending || !text.trim()}>
          <Send className="size-4" />
          <span className="hidden sm:inline">{t("send")}</span>
        </Button>
      </form>
    </div>
  );
}
