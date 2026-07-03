"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LiveInboxRefresher({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel("live-inbox")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "Message",
        },
        (payload) => {
          // Assuming we want to refresh when a message is inserted and we are a participant.
          // For simplicity, since RLS or the backend might limit who gets what, we can
          // trigger a router refresh whenever any message is inserted, or optionally check if it's not us sending it.
          // Wait, the postgres_changes event fires for ANY row if we don't have RLS or we don't filter.
          // Ideally we check if `senderId !== userId` so we don't unnecessarily refresh when WE send a message (optimistic UI usually handles that, though we don't have optimistic UI here, so maybe we refresh on all).
          if (payload.new && (payload.new as Record<string, unknown>).senderId !== userId) {
            router.refresh();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
