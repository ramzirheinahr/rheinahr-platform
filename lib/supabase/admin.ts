import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — SERVER ONLY. Used to provision/disable login
// accounts via the Auth Admin API. Never import this into a Client Component.
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
