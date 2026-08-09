/**
 * The org graph, loaded from Postgres.
 *
 * ---------------------------------------------------------------------------
 * The bug this fixes
 * ---------------------------------------------------------------------------
 *
 * Until now `getLiveViewer()` returned a REAL profile (a genuine auth UUID) but
 * handed `lib/permissions.ts` the MOCK graph. Every rule in that module starts by
 * looking the actor up:
 *
 *     graph.getMember("8f3c…")   // a real uuid, against mock data → undefined
 *
 * So in live mode the permission system was reasoning about a person who, as far
 * as the graph was concerned, did not exist. It fails closed rather than open —
 * `leadChain` and `isREofOrAbove` both bail on `undefined` — so nobody gained
 * access they shouldn't have. But every Lead and RE silently lost theirs, and the
 * symptom ("why can't I edit my own project?") points nowhere near the cause.
 *
 * ---------------------------------------------------------------------------
 * Why it loads everything at once
 * ---------------------------------------------------------------------------
 *
 * `OrgGraph`'s four methods are SYNCHRONOUS by design, and they're called in
 * loops — `leadChain` walks up a reporting chain one `getMember` at a time,
 * `isREofOrAbove` walks up a project tree. Backing them with queries would turn a
 * single permission check into dozens of round trips.
 *
 * So: four queries, up front, in parallel, closed over in Maps. The club is
 * ~40 members and ~20 projects; fetching all of it is a few kilobytes and one
 * round trip, against fifty for the alternative. Revisit at maybe 10× this size,
 * where the `v_project_re_authority` / `v_lead_chain` views become worth it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Member, Project, Team } from "../types.ts";
import type { OrgGraph } from "../permissions.ts";

/**
 * Columns to read. Written out rather than `select("*")` so that adding a column
 * to the schema doesn't silently widen what every page pulls — and so a rename
 * fails here, loudly, instead of arriving as an `undefined` three layers away.
 */
export const PROFILE_COLUMNS =
  "id, email, full_name, preferred_name, photo_url, class_year, major, phone, global_role, status, lead_id, primary_team_id, skills, joined_at, last_active_at";

export const PROJECT_COLUMNS =
  "id, name, slug, description, parent_id, team_id, primary_re_id, phase, health, start_date, target_date, dates_overridden, is_open_to_join, open_roles, time_commitment";

export const PROJECT_MEMBER_COLUMNS = "project_id, member_id";

/**
 * Teams, for the Division-Lead-is-a-top-RE rule in `leadsTeamAbove`.
 *
 * `is_active` is read but NOT filtered on. An archived division's projects keep
 * pointing at it, and the person who led it must still be able to act on that
 * history — correcting a record, reopening something. Archiving hides a
 * division from the tree; it doesn't revoke anybody's authority.
 */
export const TEAM_COLUMNS = "id, name, slug, parent_id, lead_id, is_active";

/**
 * Every table/column pair this file reads, in one place.
 *
 * `schema.test.ts` checks these against the actual `create table` statements in
 * `supabase/migrations/`, so a column that gets renamed in SQL fails the test
 * suite instead of becoming a 500 the first time someone signs in. Add an entry
 * here whenever you add a query.
 */
export const QUERIED_COLUMNS: ReadonlyArray<{
  table: string;
  columns: string;
}> = [
  { table: "profiles", columns: PROFILE_COLUMNS },
  { table: "projects", columns: PROJECT_COLUMNS },
  { table: "project_members", columns: PROJECT_MEMBER_COLUMNS },
  { table: "teams", columns: TEAM_COLUMNS },
  // Filtered on, not selected — but just as capable of being renamed.
  { table: "project_members", columns: "role, left_at" },
];

// Row shapes as Postgres returns them: snake_case, nulls rather than undefined.
// These stop at this file — CLAUDE.md's rule is that snake_case never reaches a
// component, so the mapping below is the boundary.

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  preferred_name: string | null;
  photo_url: string | null;
  class_year: number | null;
  major: string | null;
  phone: string | null;
  global_role: Member["globalRole"];
  status: Member["status"];
  lead_id: string | null;
  primary_team_id: string | null;
  skills: string[] | null;
  joined_at: string;
  last_active_at: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  team_id: string | null;
  primary_re_id: string;
  phase: Project["phase"];
  health: Project["health"];
  start_date: string | null;
  target_date: string | null;
  dates_overridden: boolean;
  is_open_to_join: boolean;
  open_roles: string | null;
  time_commitment: string | null;
}

/** One row per RE assignment — `project_members` filtered to `role = 're'`. */
interface ReRow {
  project_id: string;
  member_id: string;
}

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  lead_id: string | null;
  is_active: boolean;
}

/** `null` is Postgres's "absent"; `undefined` is the app's. Translate, don't leak. */
function optional<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

export function toMember(row: ProfileRow): Member {
  return {
    id: row.id,
    fullName: row.full_name,
    preferredName: optional(row.preferred_name),
    email: row.email,
    photoUrl: optional(row.photo_url),
    classYear: optional(row.class_year),
    major: optional(row.major),
    phone: optional(row.phone),
    globalRole: row.global_role,
    status: row.status,
    // Stays `null`, not `undefined` — `Member.leadId` is `string | null`, and
    // "reports to nobody" is meaningful (it's what a Co-Lead looks like).
    leadId: row.lead_id,
    primaryTeamId: optional(row.primary_team_id),
    skills: optional(row.skills),
    joinedAt: row.joined_at,
    // Undefined means never signed in — the distinction that separates
    // "invited but the email doesn't match" from "signed in, awaiting
    // activation". See `Member.lastActiveAt`.
    lastActiveAt: optional(row.last_active_at),
  };
}

export function toProject(row: ProjectRow, reIds: string[]): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: optional(row.description),
    parentId: row.parent_id,
    teamId: optional(row.team_id),
    primaryReId: row.primary_re_id,
    reIds,
    phase: row.phase,
    health: row.health,
    startDate: optional(row.start_date),
    targetDate: optional(row.target_date),
    datesOverridden: row.dates_overridden,
    isOpenToJoin: row.is_open_to_join,
    openRoles: optional(row.open_roles),
    timeCommitment: optional(row.time_commitment),
  };
}

/**
 * The pure half — rows in, graph out.
 *
 * Split from the fetching so it can be tested exhaustively without a database or
 * a mocked client. Every interesting case (a missing RE membership row, an
 * unknown id, a member whose lead has been deleted) is exercised in
 * `graph.test.ts`.
 */
export function buildOrgGraphFromRows(
  profileRows: ProfileRow[],
  projectRows: ProjectRow[],
  reRows: ReRow[],
  /**
   * Required, not defaulted to `[]`.
   *
   * A default would make forgetting it compile — and the failure is invisible:
   * no teams means no team leads, so every Division Lead silently loses RE
   * authority over their own division and the symptom ("why can't I sign this
   * off?") points nowhere near the cause. Same shape as the mock-data fallback
   * in docs/HANDOFF.md §2. Pass `[]` deliberately if you mean it.
   */
  teamRows: TeamRow[]
): OrgGraph {
  const reIdsByProject = new Map<string, string[]>();
  for (const row of reRows) {
    const list = reIdsByProject.get(row.project_id);
    if (list) list.push(row.member_id);
    else reIdsByProject.set(row.project_id, [row.member_id]);
  }

  const members = new Map<string, Member>();
  for (const row of profileRows) members.set(row.id, toMember(row));

  const projects = new Map<string, Project>();
  for (const row of projectRows) {
    const reIds = reIdsByProject.get(row.id) ?? [];

    // Defensive: `primary_re_id` is a NOT NULL column on `projects`, but the
    // matching `project_members` row with `role = 're'` is a separate insert
    // that nothing in the schema forces to exist. If it's missing, the primary
    // RE — the person accountable for the whole project — would have no
    // authority over it. Fold them in rather than trust two tables to agree.
    if (!reIds.includes(row.primary_re_id)) reIds.unshift(row.primary_re_id);

    projects.set(row.id, toProject(row, reIds));
  }

  const teams = new Map<string, Team>();
  for (const row of teamRows) {
    teams.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parent_id,
      leadId: optional(row.lead_id),
      isActive: row.is_active,
    });
  }

  return {
    getMember: (id) => members.get(id),
    getProject: (id) => projects.get(id),
    directREs: (projectId) => projects.get(projectId)?.reIds ?? [],
    getTeam: (id) => teams.get(id),
  };
}

/**
 * Fetch and build. Four queries, issued together.
 *
 * RLS CAVEAT, and it matters: this reads through the caller's own client, so
 * anything RLS hides is simply absent from the graph — and an absent row reads
 * as "no authority" rather than as an error. `0004_rls_policies.sql` must keep
 * `profiles` and `projects` readable by every authenticated member. That's
 * consistent with the product rule (activity is transparent; only *effort* data
 * is restricted), but if someone ever narrows those policies, permissions will
 * start failing in ways that look nothing like an RLS problem.
 */
export async function loadLiveOrgGraph(
  supabase: SupabaseClient
): Promise<OrgGraph> {
  const [profiles, projects, res, teams] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS),
    supabase.from("projects").select(PROJECT_COLUMNS),
    supabase
      .from("project_members")
      .select("project_id, member_id")
      .eq("role", "re")
      // Never-hard-delete means departed members keep their row with `left_at`
      // set. Without this filter, someone who left last year still counts as an
      // RE and can still act on the project.
      .is("left_at", null),
    supabase.from("teams").select(TEAM_COLUMNS),
  ]);

  // Fail loudly. A half-loaded graph silently strips people of authority, which
  // is far harder to diagnose than an error page.
  const failure = profiles.error ?? projects.error ?? res.error ?? teams.error;
  if (failure) {
    throw new Error(`Could not load the org graph: ${failure.message}`);
  }

  return buildOrgGraphFromRows(
    (profiles.data ?? []) as ProfileRow[],
    (projects.data ?? []) as ProjectRow[],
    (res.data ?? []) as ReRow[],
    (teams.data ?? []) as TeamRow[]
  );
}
