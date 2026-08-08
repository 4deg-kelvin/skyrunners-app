/**
 * Tests for the Postgres org graph.
 *
 * Run with:  npm test
 *
 * These matter more than most. The graph is what `lib/permissions.ts` reasons
 * over, so a mapping mistake here doesn't produce a wrong pixel — it produces a
 * wrong answer to "may this person do this", across the whole app, in live mode
 * only, where it's hardest to notice.
 *
 * `buildOrgGraphFromRows` is pure, so all of this runs with no database and no
 * mocked client.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { buildOrgGraphFromRows, toMember, toProject } from "./graph.ts";
import { can, isREofOrAbove, leadChain } from "../permissions.ts";

// --- fixtures --------------------------------------------------------------

function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    email: "a@stanford.edu",
    full_name: "A Person",
    preferred_name: null,
    photo_url: null,
    class_year: null,
    major: null,
    global_role: "member",
    status: "active",
    lead_id: null,
    primary_team_id: null,
    skills: null,
    joined_at: "2026-01-01",
    ...over,
  } as never;
}

function projectRow(over: Record<string, unknown> = {}) {
  return {
    id: "prj1",
    name: "A Project",
    slug: "a-project",
    description: null,
    parent_id: null,
    team_id: null,
    primary_re_id: "p1",
    phase: "concept",
    health: "on_track",
    start_date: null,
    target_date: null,
    dates_overridden: false,
    is_open_to_join: true,
    open_roles: null,
    time_commitment: null,
    ...over,
  } as never;
}

// --- mapping ---------------------------------------------------------------

describe("row mapping", () => {
  test("nulls become undefined, so optional fields read as absent", () => {
    const member = toMember(profileRow());
    assert.equal(member.preferredName, undefined);
    assert.equal(member.major, undefined);
    assert.equal(member.skills, undefined);
  });

  test("leadId stays null rather than becoming undefined", () => {
    // `Member.leadId` is `string | null`, and null is meaningful: it's what
    // "reports to nobody" looks like, i.e. a Co-Lead. Collapsing it to undefined
    // would be a type lie and would break `leadChain`'s termination check.
    assert.equal(toMember(profileRow()).leadId, null);
    assert.equal(toMember(profileRow({ lead_id: "p9" })).leadId, "p9");
  });

  test("snake_case columns land on camelCase fields", () => {
    const member = toMember(
      profileRow({
        full_name: "Priya Raghavan",
        preferred_name: "Pri",
        class_year: 2027,
        primary_team_id: "t1",
        global_role: "lead",
        joined_at: "2026-03-20",
      })
    );
    assert.equal(member.fullName, "Priya Raghavan");
    assert.equal(member.preferredName, "Pri");
    assert.equal(member.classYear, 2027);
    assert.equal(member.primaryTeamId, "t1");
    assert.equal(member.globalRole, "lead");
    assert.equal(member.joinedAt, "2026-03-20");
  });

  test("project booleans and dates map across", () => {
    const project = toProject(
      projectRow({
        parent_id: "prj0",
        target_date: "2026-12-01",
        dates_overridden: true,
        is_open_to_join: false,
        time_commitment: "5 hrs/wk",
      }),
      ["p1"]
    );
    assert.equal(project.parentId, "prj0");
    assert.equal(project.targetDate, "2026-12-01");
    assert.equal(project.datesOverridden, true);
    assert.equal(project.isOpenToJoin, false);
    assert.equal(project.timeCommitment, "5 hrs/wk");
  });

  test("a top-level project keeps parentId null", () => {
    // `Project.parentId` is `string | null` and the project tree walk stops on
    // null. undefined here would make `projectChain` loop or bail early.
    assert.equal(toProject(projectRow(), ["p1"]).parentId, null);
  });
});

// --- graph construction ----------------------------------------------------

describe("graph construction", () => {
  test("looks up members and projects by id", () => {
    const graph = buildOrgGraphFromRows(
      [profileRow({ id: "p1" }), profileRow({ id: "p2" })],
      [projectRow({ id: "prj1" })],
      []
    );
    assert.equal(graph.getMember("p1")?.id, "p1");
    assert.equal(graph.getMember("p2")?.id, "p2");
    assert.equal(graph.getProject("prj1")?.id, "prj1");
  });

  test("unknown ids return undefined, never throw", () => {
    const graph = buildOrgGraphFromRows([], [], []);
    assert.equal(graph.getMember("nope"), undefined);
    assert.equal(graph.getProject("nope"), undefined);
    assert.deepEqual(graph.directREs("nope"), []);
  });

  test("collects multiple REs for one project", () => {
    const graph = buildOrgGraphFromRows(
      [profileRow({ id: "p1" }), profileRow({ id: "p2" })],
      [projectRow({ id: "prj1", primary_re_id: "p1" })],
      [
        { project_id: "prj1", member_id: "p1" },
        { project_id: "prj1", member_id: "p2" },
      ]
    );
    assert.deepEqual(graph.directREs("prj1").sort(), ["p1", "p2"]);
  });

  test("keeps each project's REs separate", () => {
    const graph = buildOrgGraphFromRows(
      [profileRow({ id: "p1" }), profileRow({ id: "p2" })],
      [
        projectRow({ id: "prj1", primary_re_id: "p1" }),
        projectRow({ id: "prj2", slug: "b", primary_re_id: "p2" }),
      ],
      [
        { project_id: "prj1", member_id: "p1" },
        { project_id: "prj2", member_id: "p2" },
      ]
    );
    assert.deepEqual(graph.directREs("prj1"), ["p1"]);
    assert.deepEqual(graph.directREs("prj2"), ["p2"]);
  });

  test("the primary RE counts even with no project_members row", () => {
    // `projects.primary_re_id` and the `role = 're'` membership row are two
    // separate inserts and nothing in the schema forces them to agree. If they
    // drift, the person accountable for the project must not lose authority
    // over it.
    const graph = buildOrgGraphFromRows(
      [profileRow({ id: "p1" })],
      [projectRow({ id: "prj1", primary_re_id: "p1" })],
      [] // no membership rows at all
    );
    assert.deepEqual(graph.directREs("prj1"), ["p1"]);
  });

  test("the primary RE isn't duplicated when the row does exist", () => {
    const graph = buildOrgGraphFromRows(
      [profileRow({ id: "p1" })],
      [projectRow({ id: "prj1", primary_re_id: "p1" })],
      [{ project_id: "prj1", member_id: "p1" }]
    );
    assert.deepEqual(graph.directREs("prj1"), ["p1"]);
  });
});

// --- the thing this was built for -----------------------------------------

describe("permissions run correctly against a Postgres-shaped graph", () => {
  // uuid-shaped ids, because the bug being guarded against was mock string ids
  // ("m-anish") being used where real auth UUIDs live.
  const CO_LEAD = "11111111-1111-4111-8111-111111111111";
  const LEAD = "22222222-2222-4222-8222-222222222222";
  const MEMBER = "33333333-3333-4333-8333-333333333333";
  const PARENT_PRJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const CHILD_PRJ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const graph = buildOrgGraphFromRows(
    [
      profileRow({ id: CO_LEAD, global_role: "co_lead", lead_id: null }),
      profileRow({ id: LEAD, global_role: "lead", lead_id: CO_LEAD }),
      profileRow({ id: MEMBER, global_role: "member", lead_id: LEAD }),
    ],
    [
      projectRow({ id: PARENT_PRJ, primary_re_id: LEAD }),
      projectRow({
        id: CHILD_PRJ,
        slug: "child",
        parent_id: PARENT_PRJ,
        primary_re_id: MEMBER,
      }),
    ],
    [
      { project_id: PARENT_PRJ, member_id: LEAD },
      { project_id: CHILD_PRJ, member_id: MEMBER },
    ]
  );

  test("a real uuid actually resolves — the regression that started this", () => {
    assert.ok(
      graph.getMember(CO_LEAD),
      "A uuid must resolve against the live graph; against the mock graph it returned undefined and every permission check collapsed"
    );
  });

  test("RE authority inherits DOWN the project tree", () => {
    // LEAD is RE of the parent only, but that carries into the child.
    assert.equal(
      isREofOrAbove({ id: LEAD, globalRole: "lead" }, graph, CHILD_PRJ),
      true
    );
    // ...and not upward: the child's RE has no say over the parent.
    assert.equal(
      isREofOrAbove({ id: MEMBER, globalRole: "member" }, graph, PARENT_PRJ),
      false
    );
  });

  test("Lead authority inherits UP the reporting chain", () => {
    assert.deepEqual(leadChain(graph, MEMBER), [LEAD, CO_LEAD]);
  });

  test("a Co-Lead can still do anything", () => {
    assert.equal(
      can.manageProject({ id: CO_LEAD, globalRole: "co_lead" }, graph, CHILD_PRJ),
      true
    );
  });

  test("a plain member who is an RE can manage that project", () => {
    // The case that catches inline `globalRole` checks.
    assert.equal(
      can.manageProject({ id: MEMBER, globalRole: "member" }, graph, CHILD_PRJ),
      true
    );
  });

  test("a member cannot manage a project they have no role on", () => {
    assert.equal(
      can.manageProject({ id: MEMBER, globalRole: "member" }, graph, PARENT_PRJ),
      false
    );
  });

  test("an RE of a parent can review join requests on a child", () => {
    // Phase 2 depends on this: the approve/decline queue is gated on
    // `reviewJoinRequest`, and it must honour inherited RE authority.
    assert.equal(
      can.reviewJoinRequest({ id: LEAD, globalRole: "lead" }, graph, CHILD_PRJ),
      true
    );
  });
});
