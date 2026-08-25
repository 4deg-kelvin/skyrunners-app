/**
 * Who is signed in, and the graph the permission module needs.
 *
 * This is the ONE place the two modes diverge:
 *
 *   LIVE MODE — reads the Supabase session, then loads that person's profile.
 *   DEMO MODE — returns the mock user from `CURRENT_USER_ID`.
 *
 * Nothing downstream cares which happened. Every page just gets a `Viewer`.
 *
 */

import { cache } from "react";
import { membersSpec } from "@/lib/store/mapping";
import { redirect } from "next/navigation";

import type { Actor, OrgGraph } from "@/lib/permissions";
import type { Member } from "@/lib/types";
import { isLiveMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { preloadLiveStore } from "@/lib/store/request";
import { loadLiveOrgGraph } from "./graph";
import {
  CURRENT_USER_ID,
  directREs,
  getMember,
  getProject,
  getTeam,
} from "@/lib/mock-data";

export interface Viewer {
  member: Member;
  /** Minimal identity the permission rules operate on. */
  actor: Actor;
  /** Lookups the permission rules use to walk the two trees. */
  graph: OrgGraph;
  /** True when running on mock data with no real login. */
  isDemo: boolean;
}

/**
 * The org graph backing permission checks, on mock data.
 *
 * The live equivalent is `loadLiveOrgGraph` in `./graph.ts`. Both satisfy the
 * same synchronous `OrgGraph` interface, which is the constraint that shapes
 * everything: these lookups are called in loops while walking trees, so they
 * must never each become a database round trip. The live version therefore loads
 * every row up front and closes over Maps.
 */
function buildMockOrgGraph(): OrgGraph {
  return { getMember, getProject, directREs, getTeam };
}

/**
 * Wrapped in React's `cache()` so it runs once per request, not once per caller.
 *
 * Both the layout and every page call this. In live mode each call is a
 * `getUser()` round trip to Supabase plus a profile query, so without dedupe a
 * single navigation would make two or three of each. `cache()` is
 * request-scoped, so it doesn't leak one user's session into another's.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (isLiveMode()) {
    return getLiveViewer();
  }
  return getDemoViewer();
});

// ---------------------------------------------------------------------------
// Demo mode
// ---------------------------------------------------------------------------

async function getDemoViewer(): Promise<Viewer> {
  const viewerId = CURRENT_USER_ID;

  const member = getMember(viewerId);

  if (!member) {
    throw new Error(
      `No mock profile for "${viewerId}". Check CURRENT_USER_ID in lib/mock-data.ts.`
    );
  }

  return {
    member,
    actor: { id: member.id, globalRole: member.globalRole },
    graph: buildMockOrgGraph(),
    isDemo: true,
  };
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

async function getLiveViewer(): Promise<Viewer> {
  const supabase = await createClient();
  if (!supabase) return getDemoViewer();

  /**
   * Load the whole database for this request, before anything reads it.
   *
   * `readStore()` is synchronous by design — `OrgGraph`'s lookups run in loops
   * while walking trees, so making them async would turn one permission check
   * into fifty round trips. That means the snapshot has to be in place first.
   *
   * This is the right place for it because every page and every Server Action
   * already calls `getViewer()`. One thing to remember, in a spot nothing can
   * render without.
   */
  await preloadLiveStore();

  // getUser, not getSession — getUser revalidates the token with Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware should have caught this already; this is belt and braces for any
  // route that slips past the matcher.
  if (!user) redirect("/login");

  /*
    Columns from the shared spec, never a hand-written list.

    This had its own copy, and it fell behind three times over: `phone`,
    `discord_user_id` and `discord_verified_at` were added to the mapping and
    not here. Nothing failed — the query succeeded and the fields were just
    absent — so the profile form rendered its placeholders on top of saved
    values, and the Discord banner could never tell that somebody had verified.
  */
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(membersSpec.columns)
    .eq("id", user.id)
    .single();

  // Signed in with a valid Stanford account but no profile row.
  //
  // `0005_profile_provisioning.sql` links an auth user to their pre-created
  // profile by email on first sign-in, so this should be rare — it means nobody
  // has invited them yet. Send them somewhere that explains it.
  if (error || !profile) redirect("/auth/no-profile");

  /*
    Selecting by a string built at runtime loses the generated row type, so
    this is cast once, here, and immediately mapped through the shared spec.
    The alternative is keeping a hand-written column list for the types alone,
    which is what drifted in the first place.
  */
  const row = profile as unknown as Record<string, unknown>;
  if (row.status !== "active") redirect("/auth/inactive");

  // Same mapping the snapshot uses, so a new column reaches the viewer the
  // moment it reaches the spec.
  const member: Member = membersSpec.fromRow(row);

  return {
    member,
    actor: { id: member.id, globalRole: member.globalRole },
    // Real rows, keyed by real auth UUIDs. This previously used the mock graph,
    // which meant `getMember(<real uuid>)` returned undefined and every Lead and
    // PL silently lost their permissions in live mode.
    graph: await loadLiveOrgGraph(supabase),
    isDemo: false,
  };
}
