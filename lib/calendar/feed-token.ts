/**
 * The secret in a calendar feed URL.
 *
 * Pure functions only — no Supabase, no `next/*` — so this is testable without a
 * database and importable from anywhere. Same shape as `lib/mcp/tokens.ts`, for
 * the same reasons, with two deliberate differences noted below.
 *
 * ---------------------------------------------------------------------------
 * This token lives in a URL, and that changes the threat model
 * ---------------------------------------------------------------------------
 *
 * An MCP token travels in an `Authorization` header, which nothing logs by
 * default. A calendar feed cannot use a header at all — the member pastes a URL
 * into Apple Calendar and that URL is the only thing the client will ever send.
 * So the secret is in the path, and a URL in a path is a secret that:
 *
 *   - sits in the member's calendar settings in plain sight,
 *   - is fetched by a client that may be on a shared or managed device,
 *   - and lands in access logs at every hop.
 *
 * Two consequences, both load-bearing:
 *
 *   1. **The feed is read-only and scoped to one member's own events.** It is
 *      not an API key. The worst a leaked feed URL can do is show somebody the
 *      club sessions one member is on — which is very nearly public information
 *      already, since the calendar is transparent by design. Nothing about the
 *      feed can write, and it exposes no personal record, no reliability, no
 *      contact details.
 *   2. **Rotation exists and is one press.** Because a URL is the kind of secret
 *      that leaks by being copied into a group chat, and there is no way to
 *      un-copy it.
 *
 * The token is still stored only as a SHA-256, exactly like an MCP token: a
 * leaked database backup must not hand somebody every member's calendar.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Prefix on every feed token.
 *
 * Distinct from `skr_` on purpose. The two grant completely different things —
 * one is a read-only calendar, the other can act as the member — and a support
 * conversation that starts "I pasted my token and it didn't work" is answered
 * instantly by which prefix it has. It also keeps secret-scanning rules for the
 * two separable.
 */
export const FEED_TOKEN_PREFIX = "cal_";

/**
 * Mint a feed token. 32 bytes from the OS CSPRNG.
 *
 * `randomBytes`, never `Math.random`: the latter is seeded predictably, and one
 * guessable token here would make every member's feed guessable from any other.
 *
 * Deliberately NOT given an expiry, unlike an MCP token's 180 days. A
 * subscription is set up once and then never thought about again — that is the
 * entire value of it — and a URL that silently stops working after six months
 * would break every member's calendar at once, with no error anywhere they would
 * see it. Revocation is manual and immediate instead.
 */
export function generateFeedToken(): string {
  return `${FEED_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * What gets stored, and what a presented token is looked up by.
 *
 * Plain SHA-256 rather than bcrypt or argon2, and considered rather than lazy:
 * those exist for LOW-entropy secrets where slowness defeats a dictionary
 * attack. This is 256 bits of CSPRNG output with no structure to guess, so there
 * is no dictionary — and this hash runs on every single feed fetch, where a
 * deliberately slow KDF would add real latency to a request some clients make
 * every few minutes.
 */
export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** Shape a token must have before it is worth a database round trip. */
export function looksLikeFeedToken(value: string): boolean {
  const token = value.trim();
  return (
    token.startsWith(FEED_TOKEN_PREFIX) &&
    token.length > FEED_TOKEN_PREFIX.length + 20 &&
    // base64url only. Anything else is a mangled paste, not a real token.
    /^[A-Za-z0-9_-]+$/.test(token.slice(FEED_TOKEN_PREFIX.length))
  );
}

/**
 * Which calendar app fetched the feed, from its User-Agent.
 *
 * ---------------------------------------------------------------------------
 * This is how the "connected calendars" badge stays honest
 * ---------------------------------------------------------------------------
 *
 * With a subscription feed the server is never TOLD which client subscribed —
 * there is no handshake, no registration, just a GET. So the badge could either
 * be a claim the member types ("I use Apple Calendar"), or an observation.
 *
 * An observation is worth far more, and it is the same principle as the Discord
 * badge: that one records WHICH id was proven, so it cannot survive the number
 * changing. This records which clients have actually fetched, so it cannot claim
 * a calendar that never connected — and it appears on its own, a few minutes
 * after the member subscribes, with nothing more to press.
 *
 * The strings are stable public identifiers these clients have sent for years,
 * but they are still someone else's implementation detail. `other` is therefore
 * a first-class answer rather than a failure: an unrecognised agent still proves
 * SOMETHING is subscribed, which is the fact the badge is really reporting.
 */
export type CalendarClient = "apple" | "google" | "outlook" | "other";

export function clientFromUserAgent(agent: string | null): CalendarClient {
  const ua = (agent ?? "").toLowerCase();

  /*
    ORDER MATTERS HERE, and getting it wrong misattributes real devices.

    Both Google's and Microsoft's mobile clients carry PLATFORM tokens in their
    agent strings — `Outlook-iOS`, `Google-Calendar-Importer (Mac OS X)` — while
    Apple's own clients are identified by broad tokens like `iOS/` and
    `Mac OS X`. So the specific vendors have to be tested before the platform
    fallbacks, or Outlook on an iPhone is reported as Apple Calendar.

    A test pins this; it was wrong on the first attempt.
  */

  // Google fetches subscribed calendars with its importer, not a browser UA.
  if (ua.includes("google")) return "google";

  if (
    ua.includes("outlook") ||
    ua.includes("microsoft") ||
    ua.includes("office")
  ) {
    return "outlook";
  }

  /*
    Apple, and it takes several patterns rather than one.

    macOS Calendar fetches as `CalendarAgent`, iOS as `dataaccessd`, and both
    can appear behind a plain `Mac OS X` or `iOS` product token. Matching only
    "calendaragent" would report an iPhone as `other`, which is the commonest
    device in this club.
  */
  if (
    ua.includes("calendaragent") ||
    ua.includes("dataaccessd") ||
    ua.includes("mac os x") ||
    ua.includes("iphone") ||
    ua.includes("ios/")
  ) {
    return "apple";
  }

  return "other";
}
