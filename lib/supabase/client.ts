/**
 * Supabase client for the BROWSER (Client Components).
 *
 * Uses the anon key, which is safe to expose — Row Level Security is what
 * actually protects the data. If RLS is off, the anon key is a wide-open door,
 * which is why `0004_rls_policies.sql` isn't optional.
 *
 * Returns null in demo mode so callers degrade gracefully instead of crashing.
 */

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/env";

export function createClient() {
  const config = supabaseConfig();
  if (!config) return null;
  return createBrowserClient(config.url, config.anonKey);
}
