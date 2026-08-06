/**
 * Who is signed in, and the graph the permission module needs to answer
 * questions about them.
 *
 * PHASE 1: replace `getViewer` with the real Supabase session. Everything that
 * consumes it keeps working, because it only depends on the return shape.
 */

import type { Actor, OrgGraph } from "@/lib/permissions";
import type { Member } from "@/lib/types";
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
}

/**
 * The org graph backing permission checks.
 *
 * PHASE 1 NOTE: these three lookups get called repeatedly while walking trees,
 * so they must not each become a database round trip. Load the member and
 * project rows once per request and close over them, or push the whole check
 * into a recursive SQL view. Do not make these three functions query directly.
 */
function buildOrgGraph(): OrgGraph {
  return {
    getMember,
    getProject,
    directREs,
  };
}

export async function getViewer(): Promise<Viewer> {
  const member = getMember(CURRENT_USER_ID);

  if (!member) {
    // Once auth is real, an absent profile means "signed in but not onboarded",
    // which should redirect to the invite-acceptance flow rather than throw.
    throw new Error(
      `No profile found for current user "${CURRENT_USER_ID}". ` +
        `Check CURRENT_USER_ID in lib/mock-data.ts.`
    );
  }

  return {
    member,
    actor: { id: member.id, globalRole: member.globalRole },
    graph: buildOrgGraph(),
  };
}
