/**
 * Tests for the per-project quiet flag.
 *
 * This is the one piece of the reporting removal that ADDS a signal, so it is
 * tested harder than its size suggests. The old person-scoped version had no
 * tests at all, which is part of why nobody noticed that "nothing logged this
 * week" fired on half the club every finals week.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { quietProjects, QUIET_AFTER_DAYS } from "./quiet.ts";
import type {
  Deliverable,
  Project,
  ProjectMembership,
  WorkLog,
} from "./types.ts";

const TODAY = "2026-08-24";

function project(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    slug: id,
    parentId: null,
    primaryReId: "re1",
    reIds: ["re1"],
    phase: "build",
    health: "on_track",
    datesOverridden: false,
    isOpenToJoin: true,
    startDate: "2026-01-01",
    ...over,
  } as Project;
}

function membership(
  projectId: string,
  memberId: string,
  commitment: "committed" | "following" = "committed"
): ProjectMembership {
  return {
    projectId,
    memberId,
    role: "contributor",
    joinedAt: "2026-01-01",
    commitment,
  } as ProjectMembership;
}

function log(projectId: string, workDate: string): WorkLog {
  return {
    id: `w-${projectId}-${workDate}`,
    memberId: "m1",
    projectId,
    workDate,
    description: "did a thing",
  };
}

function deliverable(projectId: string, status = "in_progress"): Deliverable {
  return {
    id: `d-${projectId}-${status}`,
    projectId,
    title: "a task",
    ownerId: "m1",
    status,
  } as Deliverable;
}

const call = (
  projects: Project[],
  memberships: ProjectMembership[],
  logs: WorkLog[],
  deliverables: Deliverable[]
) =>
  quietProjects(
    projects,
    projects.map((p) => p.id),
    memberships,
    logs,
    deliverables,
    TODAY
  );

describe("silence is measured in days, on the project", () => {
  test("three weeks of nothing is quiet", () => {
    const p = project("p1");
    const out = call(
      [p],
      [membership("p1", "m1")],
      [log("p1", "2026-08-01")], // 23 days
      [deliverable("p1")]
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].lastLoggedAt, "2026-08-01");
    assert.equal(out[0].daysSince, 23);
  });

  test("two weeks is not, because a volunteer team has bad fortnights", () => {
    const out = call(
      [project("p1")],
      [membership("p1", "m1")],
      [log("p1", "2026-08-11")], // 13 days
      [deliverable("p1")]
    );
    assert.deepEqual(out, []);
  });

  test("the boundary is inclusive at exactly the threshold", () => {
    // Guards an off-by-one that would make the flag fire a day early forever,
    // which reads as "the app is nagging" rather than as a real signal.
    const at = new Date(Date.parse(`${TODAY}T00:00:00Z`));
    at.setUTCDate(at.getUTCDate() - QUIET_AFTER_DAYS);
    const on = at.toISOString().slice(0, 10);

    assert.equal(
      call([project("p1")], [membership("p1", "m1")], [log("p1", on)], [])
        .length,
      1
    );

    at.setUTCDate(at.getUTCDate() + 1);
    assert.equal(
      call(
        [project("p1")],
        [membership("p1", "m1")],
        [log("p1", at.toISOString().slice(0, 10))],
        []
      ).length,
      0
    );
  });

  test("the most recent entry wins, not the first", () => {
    const out = call(
      [project("p1")],
      [membership("p1", "m1")],
      [log("p1", "2026-01-02"), log("p1", "2026-08-20")],
      [deliverable("p1")]
    );
    assert.deepEqual(out, []);
  });

  test("a log on another project doesn't count", () => {
    const out = call(
      [project("p1")],
      [membership("p1", "m1")],
      [log("p2", TODAY)],
      [deliverable("p1")]
    );
    assert.equal(out.length, 1);
  });
});

describe("what is deliberately not flagged", () => {
  test("a completed project is supposed to be silent", () => {
    const out = call(
      [project("p1", { phase: "complete" })],
      [membership("p1", "m1")],
      [],
      [deliverable("p1")]
    );
    assert.deepEqual(out, []);
  });

  test("nothing at stake: no committed members and no open work", () => {
    // /find-work already ranks unstaffed projects first, and the action there
    // is "somebody join this" rather than "an RE chase somebody".
    const out = call([project("p1")], [], [], []);
    assert.deepEqual(out, []);
  });

  test("following alone is not enough — watching isn't working", () => {
    const out = call(
      [project("p1")],
      [membership("p1", "m1", "following")],
      [],
      []
    );
    assert.deepEqual(out, []);
  });

  test("a signed-off deliverable is not open work", () => {
    const out = call([project("p1")], [], [], [deliverable("p1", "done")]);
    assert.deepEqual(out, []);
  });

  test("a brand-new project is new, not quiet", () => {
    const out = call(
      [project("p1", { startDate: "2026-08-20" })],
      [membership("p1", "m1")],
      [],
      [deliverable("p1")]
    );
    assert.deepEqual(out, []);
  });

  test("a project outside the caller's scope is never returned", () => {
    const mine = project("mine");
    const theirs = project("theirs");
    const out = quietProjects(
      [mine, theirs],
      ["mine"],
      [membership("mine", "m1"), membership("theirs", "m2")],
      [],
      [deliverable("mine"), deliverable("theirs")],
      TODAY
    );
    assert.deepEqual(
      out.map((q) => q.project.id),
      ["mine"]
    );
  });
});

describe("never logged at all", () => {
  test("an old project with open work and no history is flagged", () => {
    const out = call(
      [project("p1", { startDate: "2026-01-01" })],
      [membership("p1", "m1")],
      [],
      [deliverable("p1")]
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].lastLoggedAt, undefined);
    assert.equal(out[0].daysSince, undefined);
  });

  test("an undated project is flagged rather than skipped", () => {
    /*
      Deliberate, and it is the 994-project incident's shape: an assistant
      created hundreds of empty shells through correctly-applied permissions.
      An undated project with members or open work and no activity ever is
      exactly what that looks like, so the flag should catch it.
    */
    const out = call(
      [project("p1", { startDate: undefined })],
      [membership("p1", "m1")],
      [],
      []
    );
    assert.equal(out.length, 1);
  });

  test("never-logged sorts above merely-stale", () => {
    const out = call(
      [project("stale"), project("never")],
      [membership("stale", "m1"), membership("never", "m2")],
      [log("stale", "2026-07-01")],
      [deliverable("stale"), deliverable("never")]
    );
    assert.deepEqual(
      out.map((q) => q.project.id),
      ["never", "stale"]
    );
  });

  test("longer silence sorts first among stale ones", () => {
    const out = call(
      [project("recent"), project("ancient")],
      [membership("recent", "m1"), membership("ancient", "m2")],
      [log("recent", "2026-08-01"), log("ancient", "2026-03-01")],
      []
    );
    assert.deepEqual(
      out.map((q) => q.project.id),
      ["ancient", "recent"]
    );
  });
});

describe("no per-person breakdown, deliberately", () => {
  test("the result carries counts, never member ids", () => {
    /*
      The regression guard. The work logs carry `memberId`, so adding "who has
      been quiet" here is a two-line change -- and it rebuilds the thing the club
      removed: a list of names ranked by how recently each person showed up.
      The unit is the project. See the header of lib/quiet.ts.
    */
    const out = call(
      [project("p1")],
      [membership("p1", "m1")],
      [log("p1", "2026-07-01")],
      [deliverable("p1")]
    );
    const flat = JSON.stringify(out[0]);
    for (const banned of ["memberId", "members", "quietMembers", "ownerId"]) {
      assert.ok(
        !flat.includes(`"${banned}"`),
        `"${banned}" is in the quiet flag — the unit is the project, not the person.`
      );
    }
  });
});
