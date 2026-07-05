"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Keeps every portal live without a manual page refresh: notifications and inbox
// messages appear on their own. Two mechanisms run together so the feature works
// regardless of Supabase Realtime configuration:
//   1. Realtime (instant) — postgres INSERTs on `notifications` (for this user)
//      and `messages` (from someone else) trigger a soft refresh.
//   2. Polling fallback (guaranteed) — a visibility-aware soft refresh every
//      POLL_MS while the tab is focused, in case Realtime isn't enabled.
// router.refresh() is a soft refresh: server components re-render (new bell
// count, new list rows) while client state (open forms) is preserved.
const POLL_MS = 20_000;

export function LivePortalUpdates({ userId }: { userId: string }) {
  const router = useRouter();
  // Coalesce bursts of triggers into a single refresh.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refreshSoon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 400);
    };

    // 1. Realtime (best effort — silently inert if not enabled on the project).
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`live-portal-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => refreshSoon(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row?.sender_id !== userId) refreshSoon();
        },
      )
      .subscribe();

    // 2. Polling fallback — only while the tab is visible.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);

    // Refresh immediately when the user returns to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
