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
 * TEST-ENV:START — remove with `npm run remove:test-env`
 * With `SKYRUNNERS_TEST_ENV=1`, the demo branch also honours a persona cookie so
 * you can browse as a Member, a Team Lead or a Co-Lead. That override lives here
 * and nowhere else, for the same reason the mode check does: this file is the one
 * place allowed to decide who the viewer is.
 * TEST-ENV:END
 */

import { cache } from "react";
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
} from "@/lib/mock-data";
// TEST-ENV:START — remove with `npm run remove:test-env`
import { readTestPersonaId } from "@/lib/test-env";
// TEST-ENV:END

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
  return { getMember, getProject, directREs };
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
  // TEST-ENV:START — remove with `npm run remove:test-env`
  // Returns null unless SKYRUNNERS_TEST_ENV=1, so this is a no-op by default.
  const viewerId = (await readTestPersonaId()) ?? CURRENT_USER_ID;
  // TEST-ENV:REPLACE-WITH const viewerId = CURRENT_USER_ID;
  // TEST-ENV:END

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

  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, preferred_name, photo_url, class_year, major, global_role, status, lead_id, primary_team_id, skills, joined_at"
    )
    .eq("id", user.id)
    .single();

  // Signed in with a valid Stanford account but no profile row.
  //
  // `0005_profile_provisioning.sql` links an auth user to their pre-created
  // profile by email on first sign-in, so this should be rare — it means nobody
  // has invited them yet. Send them somewhere that explains it.
  if (error || !profile) redirect("/auth/no-profile");

  if (profile.status !== "active") redirect("/auth/inactive");

  const member: Member = {
    id: profile.id,
    fullName: profile.full_name,
    preferredName: profile.preferred_name ?? undefined,
    email: profile.email,
    photoUrl: profile.photo_url ?? undefined,
    classYear: profile.class_year ?? undefined,
    major: profile.major ?? undefined,
    globalRole: profile.global_role,
    status: profile.status,
    leadId: profile.lead_id,
    primaryTeamId: profile.primary_team_id ?? undefined,
    skills: profile.skills ?? undefined,
    joinedAt: profile.joined_at,
  };

  return {
    member,
    actor: { id: member.id, globalRole: member.globalRole },
    // Real rows, keyed by real auth UUIDs. This previously used the mock graph,
    // which meant `getMember(<real uuid>)` returned undefined and every Lead and
    // RE silently lost their permissions in live mode.
    graph: await loadLiveOrgGraph(supabase),
    isDemo: false,
  };
}
