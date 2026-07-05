"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

// Page-scoped live updates for DATA tables (not just notifications): subscribes
// to Supabase Realtime row changes on the given tables and does a coalesced soft
// refresh (server components re-render, client form state preserved). No polling
// of its own — the global LivePortalUpdates already polls every 20s as a
// fallback, so this only adds instant reactivity, not extra DB load.
//
// Mount it on pages whose visible data changes from OTHER users' actions
// (master schedule grid, order detail, worker/client schedules).
export function LiveRefresher({ tables }: { tables: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable key so the effect doesn't resubscribe on every render.
  const key = tables.join(",");

  useEffect(() => {
    const refreshSoon = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        // Only refresh a visible tab; catch up on return via visibilitychange.
        if (document.visibilityState === "visible") router.refresh();
      }, 400);
    };

    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(`live-data-${key}`);
    for (const table of key.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => refreshSoon(),
      );
    }
    channel.subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") refreshSoon();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [router, key]);

  return null;
}
