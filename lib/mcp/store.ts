/**
 * Token CRUD, straight to Postgres.
 *
 * Deliberately NOT through `lib/store/*`. That layer loads every table into a
 * per-request snapshot so pages can read synchronously, and credentials have no
 * business in a structure that renders pages — every project page would be
 * carrying the club's API keys around in memory for no reason.
 *
 * Uses the ordinary cookie-backed client, so RLS applies: migration 0036 scopes
 * every policy to `auth.uid()`, and a member genuinely cannot see or revoke
 * somebody else's token. Not even a Co-Lead. A token is a credential, not club
 * data, and there is no administrative reason to read one.
 */

import { createClient } from "@/lib/supabase/server";
import {
  cleanTokenName,
  expiryFrom,
  generateToken,
  hashToken,
  isTokenScope,
  type TokenScope,
} from "./tokens";

export interface TokenSummary {
  id: string;
  name: string;
  scope: TokenScope;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
  revokedAt?: string;
}

const COLUMNS =
  "id, name, scope, created_at, last_used_at, expires_at, revoked_at";

function toSummary(row: Record<string, unknown>): TokenSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    scope: isTokenScope(row.scope) ? row.scope : "read",
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string) ?? undefined,
    expiresAt: row.expires_at as string,
    revokedAt: (row.revoked_at as string) ?? undefined,
  };
}

/** Live tokens for the signed-in member, newest first. */
export async function listMyTokens(): Promise<TokenSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("mcp_tokens")
    .select(COLUMNS)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map((r) => toSummary(r as Record<string, unknown>));
}

export type CreateResult =
  { ok: true; token: string; name: string } | { ok: false; error: string };

/**
 * Mint a token and return the plaintext ONCE.
 *
 * The caller must show it immediately and never store it — only the hash is
 * written, so this is genuinely the only moment it exists anywhere readable.
 */
export async function createMyToken(input: {
  memberId: string;
  name: string;
  scope: TokenScope;
}): Promise<CreateResult> {
  const name = cleanTokenName(input.name);
  if (!name) {
    return {
      ok: false,
      error:
        "Give the token a name — you'll need it to know which one to revoke.",
    };
  }

  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false,
      error: "Tokens need a real database — this is demo mode.",
    };
  }

  // Five is well past what anyone needs and low enough that a runaway script
  // can't fill the table.
  const existing = await listMyTokens();
  if (existing.length >= 5) {
    return {
      ok: false,
      error: "You already have five active tokens. Revoke one first.",
    };
  }

  const token = generateToken();

  const { error } = await supabase.from("mcp_tokens").insert({
    member_id: input.memberId,
    name,
    token_hash: hashToken(token),
    scope: input.scope,
    expires_at: expiryFrom(new Date()),
  });

  /*
    RLS does not raise on a missing policy — the statement matches nothing and
    reports success — which is why this checks the error rather than assuming.
    Same reasoning as `persistDiff`; see CLAUDE.md §12.
  */
  if (error) {
    return { ok: false, error: `Couldn't create that token: ${error.message}` };
  }

  return { ok: true, token, name };
}

/** Revoke, rather than delete: the row is the record that it existed. */
export async function revokeMyToken(tokenId: string): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return "Tokens need a real database — this is demo mode.";

  const { data, error } = await supabase
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("revoked_at", null)
    .select("id");

  if (error) return `Couldn't revoke that token: ${error.message}`;
  // Zero rows means RLS refused it or it was already gone. Both are "no".
  if (!data || data.length === 0) return "That token is already revoked.";
  return null;
}
