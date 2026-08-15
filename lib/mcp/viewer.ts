/**
 * Turning a bearer token into the same `Viewer` every page uses.
 *
 * ===========================================================================
 * READ THIS BEFORE ADDING A TOOL
 * ===========================================================================
 *
 * The snapshot for an MCP request is loaded with the SERVICE-ROLE client, which
 * bypasses RLS. That is a deliberate trade and it comes with a hard condition.
 *
 * Why it's necessary: `loadSnapshot` needs a Supabase client authenticated as
 * the member, and there isn't one. The project signs JWTs with ES256
 * asymmetric keys, so there's no shared secret to mint a user token with;
 * storing refresh tokens would mean handling rotation, and two concurrent MCP
 * calls racing a rotation would silently log the user out.
 *
 * What it costs: on the website, RLS shapes the snapshot per-user, so even a
 * buggy page cannot show you somebody else's private half. Here it doesn't.
 *
 * **The compensating rule, which is the actual safety property:**
 *
 *   > No MCP tool returns another member's effort data — hours, check-in
 *   > contents, reliability, or their personal report. Not for a Lead, not for
 *   > a Co-Lead, not for anyone.
 *
 * The privacy boundary is enforced by WHICH TOOLS EXIST rather than by a
 * filter that could be wrong. Every restricted question answers "use the
 * website", where the session is real and RLS is doing its job. If you are
 * about to add a tool that reads `workLogs`, `progressUpdates` or
 * `update_entries` for anybody but the caller, the answer is no — put it on
 * the website instead.
 *
 * Writes were never protected by RLS in this app anyway (CLAUDE.md: "Reads via
 * Supabase client + RLS; writes via Server Actions calling
 * lib/permissions.ts"), so every tool that changes something calls `can.*`
 * exactly as its Server Action counterpart does.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { loadLiveOrgGraph, toMember } from "@/lib/data/graph";
import { membersSpec } from "@/lib/store/mapping";
import { isLiveMode } from "@/lib/env";
import type { Actor, OrgGraph } from "@/lib/permissions";
import type { Member } from "@/lib/types";
import {
  checkTokenRow,
  hashToken,
  looksLikeToken,
  TOKEN_REJECTION_MESSAGES,
  type TokenRejection,
  type TokenRow,
  type TokenScope,
} from "./tokens";

export interface McpViewer {
  member: Member;
  actor: Actor;
  graph: OrgGraph;
  /** What this particular token is allowed to do. */
  scope: TokenScope;
  tokenId: string;
  tokenName: string;
  /** The client the store should read and write through. */
  client: NonNullable<ReturnType<typeof createAdminClient>>;
}

export type ViewerResult =
  { ok: true; viewer: McpViewer } | { ok: false; error: string };

/**
 * Resolve a token to a viewer.
 *
 * Every failure returns the same *shape* but a specific sentence, because the
 * caller is a language model that will relay it to a person. "Unauthorized"
 * produces a shrug; "that token expired, make a new one in Settings" produces
 * the fix.
 */
export async function viewerFromToken(
  rawToken: string | null
): Promise<ViewerResult> {
  if (!isLiveMode()) {
    return {
      ok: false,
      error:
        "This server is running in demo mode with no database, so there is nothing to connect to.",
    };
  }

  if (!rawToken || !looksLikeToken(rawToken)) {
    return { ok: false, error: reject("malformed") };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      error:
        "The MCP server isn't configured on this deployment — SUPABASE_SERVICE_ROLE_KEY is missing.",
    };
  }

  const { data, error } = await admin
    .from("mcp_tokens")
    .select("id, member_id, name, scope, expires_at, revoked_at")
    .eq("token_hash", hashToken(rawToken))
    .maybeSingle();

  if (error) {
    /*
      The database's own message is logged, not returned.

      This branch is reachable by ANYONE who can POST to the endpoint, with no
      valid credential, so whatever it returns is public. A Postgres error can
      name tables, columns and constraints, and handing that to an unauthenticated
      caller is free reconnaissance for nothing in return — the member reading the
      relayed sentence can't act on it either way.
    */
    console.error("[mcp] token lookup failed", error);
    return {
      ok: false,
      error:
        "Couldn't check that token — the club's database didn't answer. Try again in a moment; if it keeps happening, tell whoever runs the site.",
    };
  }

  const row = (data ?? null) as TokenRow | null;
  const rejection = checkTokenRow(row, new Date());
  if (rejection || !row)
    return { ok: false, error: reject(rejection ?? "unknown") };

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select(membersSpec.columns)
    .eq("id", row.member_id)
    .maybeSingle();

  if (profileError || !profile) {
    return {
      ok: false,
      error:
        "That token belongs to an account that no longer exists in the club.",
    };
  }

  const member = membersSpec.fromRow(
    profile as unknown as Record<string, unknown>
  );
  if (member.status !== "active") {
    return { ok: false, error: reject("not_active") };
  }

  /*
    Last-used is best-effort and deliberately not awaited for correctness —
    a failed bookkeeping write must never fail the request the member asked
    for. It only exists so a dormant token is visible in Settings.
  */
  void admin
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return {
    ok: true,
    viewer: {
      member,
      actor: { id: member.id, globalRole: member.globalRole },
      /*
        The same graph builder the live viewer uses. Not a hand-rolled one:
        `buildOrgGraphFromRows` takes `teamRows` as a required argument
        precisely because forgetting them compiles fine and silently strips
        every Division Lead of authority over their own division — which is
        exactly the bug that would surface here as "the MCP says I can't
        assign work on my own projects".
      */
      graph: await loadLiveOrgGraph(admin),
      scope: row.scope === "write" ? "write" : "read",
      tokenId: row.id,
      tokenName: row.name,
      client: admin,
    },
  };
}

function reject(kind: TokenRejection): string {
  return TOKEN_REJECTION_MESSAGES[kind];
}

/** Re-exported so the tool layer doesn't need to know where members come from. */
export { toMember };
