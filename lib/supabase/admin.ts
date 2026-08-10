import { createClient } from "@supabase/supabase-js";

/**
 * ============================================================================
 * The service-role client. Read this before using it anywhere.
 * ============================================================================
 *
 * This key **bypasses every row-level security policy in the database**. It is
 * the one credential in the project that can read and write anything as
 * anybody, and `docs/HANDOFF.md` has three separate bugs in it caused by RLS
 * behaving in ways people didn't expect — none of which this client would have
 * caught, because it is never subject to them.
 *
 * ---------------------------------------------------------------------------
 * There is exactly one legitimate caller, and it is the cron
 * ---------------------------------------------------------------------------
 *
 * A scheduled job runs with no signed-in user. There is no session, no
 * `auth.uid()`, and therefore no policy that can grant it anything — a normal
 * client would read zero rows and report success, which is the silent-failure
 * shape this codebase has been bitten by repeatedly.
 *
 * **Never import this from a page, a Server Action, or `lib/data/*`.** Those
 * all run as a real member and must stay inside RLS: that's what makes the
 * privacy model enforceable rather than merely intended. If you find yourself
 * reaching for this to make a permission problem go away, the permission
 * problem is the thing to fix.
 *
 * Returns null when the key isn't configured, so a fresh clone and a demo
 * deploy both run normally — the cron reports itself unconfigured instead of
 * crashing on every tick.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      // No session to persist and nothing to refresh — this client is used for
      // one query and thrown away.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
