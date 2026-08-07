/**
 * Who is signed in, and the graph the permission module needs.
 *
 * This is the ONE place the two modes diverge:
 *
 *   LIVE MODE — reads the Supabase session, then loads that person's profile.
 *   DEMO MODE — returns the mock user from `CURRENT_USER_ID`.
 *
 * Nothing downstream cares which happened. Every page just gets a `Viewer`.
 */

import { cache } from "react";
import { redirect } from "next/navigation";

import type { Actor, OrgGraph } from "@/lib/permissions";
import type { Member } from "@/lib/types";
import { isLiveMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_USER_ID,
  directREs,
  getMember,
  getProject,
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
 * The org graph backing permission checks.
 *
 * PHASE 1b NOTE: these three lookups get called repeatedly while walking trees,
 * so they must not each become a database round trip. Load the member and
 * project rows once per request and close over them, or push the check into the
 * `v_project_re_authority` / `v_lead_chain` views. Do NOT make these query
 * directly — that's how a permission check turns into fifty queries.
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

function getDemoViewer(): Viewer {
  const member = getMember(CURRENT_USER_ID);

  if (!member) {
    throw new Error(
      `No mock profile for "${CURRENT_USER_ID}". Check CURRENT_USER_ID in lib/mock-data.ts.`
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
    // PHASE 1b: replace with a request-scoped graph loaded from Postgres. Until
    // the rest of lib/data is switched over, the mock graph keeps the app
    // coherent rather than half-real.
    graph: buildMockOrgGraph(),
    isDemo: false,
  };
}
