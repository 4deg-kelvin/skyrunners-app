/**
 * ============================================================================
 * DEMO MODE vs LIVE MODE
 * ============================================================================
 *
 * The app runs in one of two modes, decided entirely by whether the Supabase
 * environment variables are present:
 *
 *   DEMO MODE  — no env vars. Runs on `lib/mock-data.ts`, no login required.
 *                This is what `npm run dev` does on a fresh clone.
 *
 *   LIVE MODE  — env vars set. Real Stanford Google sign-in, real Postgres.
 *
 * ----------------------------------------------------------------------------
 * Why this exists
 * ----------------------------------------------------------------------------
 *
 * Kelvin owns the Supabase project and will set it up on his own timeline. If the
 * app *required* a live database to run, Anish would be blocked until then —
 * which is exactly the sort of dependency that stalls a two-person project for a
 * fortnight.
 *
 * With this switch, feature work continues on mock data, and the day the keys
 * land the app flips to real data with no code changes. Nothing else in the
 * codebase needs to know which mode it's in; `lib/data/*` handles it.
 *
 * It also means a new contributor can clone the repo and see a working app in
 * two commands, which matters for onboarding whoever inherits this after
 * graduation.
 */

/**
 * The browser-safe API key.
 *
 * Supabase renamed this. Projects created before the change hand you an
 * "anon key" (`NEXT_PUBLIC_SUPABASE_ANON_KEY`); the current dashboard hands you
 * a "publishable key" (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, prefixed
 * `sb_publishable_`). They occupy exactly the same slot — both ship to the
 * browser, and RLS is what decides what they can read.
 *
 * Accepting either means the app works whichever the dashboard shows on the day,
 * and nobody has to debug "I pasted the key and it's still in demo mode".
 * Publishable wins if both are set, since that's the newer name.
 */
function publishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** True when Supabase credentials are configured. */
export function isLiveMode(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && publishableKey());
}

/** True when running on mock data with no login. */
export function isDemoMode(): boolean {
  return !isLiveMode();
}

/**
 * Supabase config, or null in demo mode.
 *
 * Returns null rather than throwing so that importing this file is always safe —
 * a missing key should degrade to demo mode, not crash the app.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = publishableKey();
  if (!url || !anonKey) return null;
  // Field stays named `anonKey` because that's the argument name Supabase's own
  // client takes. Renaming it here would only add a translation step.
  return { url, anonKey };
}

/**
 * Only Stanford accounts. Enforced in three places, deliberately:
 *   1. the Google consent screen (configured in Supabase)
 *   2. here, on callback, so a stray account can't slip through
 *   3. a CHECK constraint on `profiles.email` in the database
 *
 * Access control that matters is worth stating more than once.
 */
export const ALLOWED_EMAIL_DOMAIN = "stanford.edu";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
