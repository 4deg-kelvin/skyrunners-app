/**
 * Calendar feed CRUD, straight to Postgres.
 *
 * Deliberately NOT through `lib/store/*`, for exactly the reason `lib/mcp/store.ts`
 * isn't: that layer loads every table into a per-request snapshot so pages can
 * read synchronously, and a credential has no business in a structure that
 * renders pages. Every project page would otherwise be carrying every member's
 * calendar token around in memory.
 *
 * Two different clients, on purpose:
 *
 *   - `createClient()` — the ordinary cookie-backed one, so RLS applies. Used by
 *     everything a signed-in member does to their OWN feed. Migration 0041 scopes
 *     the policy to `auth.uid()`, so a member genuinely cannot see or rotate
 *     somebody else's, not even a Co-Lead.
 *   - `createAdminClient()` — service role, used by ONE function: `feedByToken`. The
 *     feed is fetched by Apple Calendar, not a browser; there is no session and
 *     `auth.uid()` is null, so the RLS policy correctly does not match and the
 *     token is the whole authentication. Same shape as `lib/mcp/viewer.ts`.
 *
 * `createClient()` returns null in demo mode, and every function here degrades to
 * "no feed" rather than throwing — a fresh clone has to run, which is the whole
 * point of demo mode.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  clientFromUserAgent,
  generateFeedToken,
  hashFeedToken,
  looksLikeFeedToken,
  type CalendarClient,
} from "./feed-token";

export interface FeedSummary {
  id: string;
  createdAt: string;
}

const COLUMNS = "id, member_id, created_at, revoked_at";

/**
 * The signed-in member's live feed, or null if they have never made one.
 *
 * Only answers "is there one" and "since when". The interesting state — which
 * calendar apps have actually collected it — is on `profiles` and comes from
 * `viewer.member`, because it is PUBLIC: see the note in migration 0041 about
 * why the credential and the observation live in different tables.
 */
export async function myFeed(): Promise<FeedSummary | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("calendar_feeds")
    .select(COLUMNS)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id as string,
    createdAt: data.created_at as string,
  };
}

export type FeedCreateResult =
  { ok: true; url: string } | { ok: false; error: string };

/**
 * Create or replace the member's feed, returning the full subscription URL.
 *
 * The plaintext token exists only in this return value — only its hash is
 * written — but unlike an MCP token this one is deliberately RE-SHOWABLE, by
 * rotating. A calendar URL has to be pasted into every device the member owns,
 * possibly weeks apart, so "shown once and never again" would mean rotating just
 * to add an iPad and silently breaking the phone.
 *
 * Rotation is what revocation looks like here: `upsert` on `member_id` replaces
 * the hash, so the previous URL stops working immediately. The UI says so,
 * because a member who rotates to add a device would otherwise wonder why their
 * laptop went blank.
 */
export async function rotateMyFeed(input: {
  memberId: string;
  origin: string;
}): Promise<FeedCreateResult> {
  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false,
      error:
        "Calendar subscriptions need the live database — this is demo mode, so there is nothing to subscribe to.",
    };
  }

  const token = generateFeedToken();

  const { error } = await supabase.from("calendar_feeds").upsert(
    {
      member_id: input.memberId,
      token_hash: hashFeedToken(token),
      revoked_at: null,
    },
    { onConflict: "member_id" }
  );

  if (error) {
    return {
      ok: false,
      error: `Couldn't create the subscription — the database refused it: ${error.message}`,
    };
  }

  return { ok: true, url: feedUrl(input.origin, token) };
}

/** Turn off the subscription without minting a new one. */
export async function revokeMyFeed(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "Not available in demo mode." };

  const { error } = await supabase
    .from("calendar_feeds")
    .update({ revoked_at: new Date().toISOString() })
    .is("revoked_at", null);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** The subscription URL for a token. `webcal://` is handled at the render site. */
export function feedUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/api/calendar/${token}/skyrunners.ics`;
}

/**
 * Resolve a presented token to the member it belongs to. SERVICE ROLE.
 *
 * The only function here that bypasses RLS, and the reason is structural: the
 * caller is Apple Calendar, which carries no session, so `auth.uid()` is null and
 * the member-scoped policy correctly matches nothing. The token is the
 * authentication.
 *
 * The shape check runs FIRST so a mangled paste — the commonest failure by far —
 * costs no database round trip.
 */
export async function feedByToken(
  token: string
): Promise<{ memberId: string; feedId: string } | null> {
  if (!looksLikeFeedToken(token)) return null;

  const supabase = createAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("calendar_feeds")
    .select("id, member_id")
    .eq("token_hash", hashFeedToken(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  return { memberId: data.member_id as string, feedId: data.id as string };
}

/**
 * Record that a calendar app fetched the feed. SERVICE ROLE, fire and forget.
 *
 * This is the entire mechanism behind the connected-calendars badge — see the
 * header of `feed-token.ts`. It never blocks or fails the response: a member
 * whose calendar works but whose badge is a few minutes stale has no problem,
 * whereas a feed that 500s because a bookkeeping write failed has a real one.
 */
export async function recordFeedFetch(input: {
  memberId: string;
  userAgent: string | null;
  /** What is already recorded, so a repeat fetch writes the same array back. */
  knownClients: string[];
}): Promise<void> {
  const supabase = createAdminClient();
  if (!supabase) return;

  const client = clientFromUserAgent(input.userAgent);
  const seen = input.knownClients.includes(client)
    ? input.knownClients
    : [...input.knownClients, client];

  try {
    /*
      `profiles`, not `calendar_feeds`, and that is the whole reason the badge
      works: the feed table is owner-only by RLS, so a badge reading from there
      would be invisible to everybody except the one person who does not need it.
      `profiles.discord_verified_at` set the precedent — see migration 0041.
    */
    await supabase
      .from("profiles")
      .update({
        calendar_clients: seen,
        calendar_synced_at: new Date().toISOString(),
      })
      .eq("id", input.memberId);
  } catch {
    // Deliberately swallowed. See above.
  }
}
