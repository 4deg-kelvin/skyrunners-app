/**
 * Personal tokens for the MCP server.
 *
 * Pure functions only — no Supabase, no `next/*` — so this is testable without
 * a database and importable from anywhere.
 *
 * The token is shown to its owner exactly once, at creation, and only its
 * SHA-256 is stored (migration 0036). That means there is no "show it again"
 * anywhere in the app, deliberately: a leaked database backup must not hand
 * somebody the club's whole API.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Prefix on every token.
 *
 * Not decoration. Secret-scanning tools (GitHub's included) match on
 * recognisable prefixes, and a token pasted into a public repo or a Discord
 * channel is the realistic way one of these leaks. A bare base64 blob is
 * invisible to every scanner there is.
 */
export const TOKEN_PREFIX = "skr_";

/** How long a fresh token is good for, unless revoked sooner. */
export const TOKEN_TTL_DAYS = 180;

export type TokenScope = "read" | "write";

export function isTokenScope(value: unknown): value is TokenScope {
  return value === "read" || value === "write";
}

/**
 * Mint a new token.
 *
 * 32 bytes from the OS CSPRNG. `randomBytes`, never `Math.random` — the latter
 * is seeded predictably and would make every token in the club guessable from
 * any other.
 */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * What gets stored, and what a presented token is looked up by.
 *
 * Plain SHA-256 rather than bcrypt/argon2, and that's a considered choice
 * rather than a shortcut: those are for LOW-entropy secrets, where slowness is
 * what stops an offline dictionary attack. This is 256 bits of CSPRNG output
 * with no structure to guess, so there is no dictionary — and the MCP server
 * hashes on every single request, where a deliberately slow KDF would add real
 * latency to every call for no security gain.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/** Shape a token must have before it's worth a database round trip. */
export function looksLikeToken(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith(TOKEN_PREFIX) &&
    trimmed.length >= TOKEN_PREFIX.length + 40
  );
}

/**
 * Pull the token out of an Authorization header.
 *
 * Accepts a bare token as well as `Bearer <token>`, because MCP clients differ
 * and somebody pasting the raw value into the wrong config field should get a
 * working connection rather than a puzzle.
 */
export function tokenFromHeader(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim();
  const bare = value.toLowerCase().startsWith("bearer ")
    ? value.slice(7).trim()
    : value;
  return bare ? bare : null;
}

export interface TokenRow {
  id: string;
  member_id: string;
  name: string;
  scope: string;
  expires_at: string;
  revoked_at: string | null;
}

export type TokenRejection =
  "malformed" | "unknown" | "revoked" | "expired" | "not_active";

/**
 * Is this row usable right now?
 *
 * Split out from the lookup so the rules are testable without a database, and
 * so the ORDER is pinned: revoked before expired. Somebody who revoked a token
 * after a scare needs to hear "revoked", not "expired" — the two call for
 * completely different reactions.
 */
export function checkTokenRow(
  row: TokenRow | null,
  now: Date
): TokenRejection | null {
  if (!row) return "unknown";
  if (row.revoked_at) return "revoked";
  if (Date.parse(row.expires_at) <= now.getTime()) return "expired";
  return null;
}

/** A complete sentence for each refusal — the model relays these to a human. */
export const TOKEN_REJECTION_MESSAGES: Record<TokenRejection, string> = {
  malformed:
    "That doesn't look like a SkyRunners token. They start with `skr_` and are made in Settings on the website.",
  unknown:
    "That token isn't recognised. It may have been deleted — make a new one in Settings on the website.",
  revoked:
    "That token has been revoked. Make a new one in Settings on the website.",
  expired:
    "That token has expired. Tokens last 180 days — make a new one in Settings on the website.",
  not_active:
    "That account isn't active in the club, so it can't be used to sign in.",
};

/** When a token created now should stop working. */
export function expiryFrom(now: Date): string {
  return new Date(
    now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * A token name that's safe to render and useful to read.
 *
 * Names come from a text input and end up in a list next to a revoke button,
 * so the only real requirement is that it's short and not empty.
 */
export function cleanTokenName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 60);
}
