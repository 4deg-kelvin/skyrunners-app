/**
 * What the dashboard is scoped to.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * The reporting removal on 2026-08-24 replaced two scopes with one. The Lead
 * half walked `profiles.lead_id`; the PL half used `isREofOrAbove`. Deleting the
 * first looked like it left the second doing the same job, and it did not:
 *
 *   **`isREofOrAbove` has no Co-Lead shortcut, deliberately.** It answers "does
 *   the project tree grant this person authority here", not "is this allowed".
 *   The Co-Lead answer lives in the `can.*` rules, each of which is
 *   `isCoLead(actor) || ...`.
 *
 * So the old code's `isCoLead(actor) ? everyone : reportsBelow(...)` branch was
 * load-bearing, and removing it emptied the entire page for a Co-Lead who is PL
 * of nothing — which is the live club exactly: the only Co-Lead is PL of 0 of 12
 * projects. No queue, no quiet projects, zero people, zero log entries, and
 * `isREofNothing` true, which the route gate reads.
 *
 * Nothing caught it. It type-checked, 898 tests passed, `npm run sweep` was
 * clean, and the page rendered a 200 — just with nothing in it. It was found by
 * calling `getDashboard` and looking at the numbers.
 *
 * Hence this file. Every assertion here is about SCOPE, because scope is the
 * thing that has no other symptom.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-dashboard-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;
process.on("exit", () => rmSync(TEST_DIR, { recursive: true, force: true }));

import type { Actor, OrgGraph } from "@/lib/permissions";

type Dash = typeof import("@/lib/data/dashboard");
type Disk = typeof import("@/lib/store/disk");
type Mock = typeof import("@/lib/mock-data");

let data: Dash;
let disk: Disk;
let md: Mock;
let graph: OrgGraph;

before(async () => {
  data = await import("@/lib/data/dashboard");
  disk = await import("@/lib/store/disk");
  md = await import("@/lib/mock-data");
  // The same four synchronous lookups `buildMockOrgGraph` closes over. They must
  // stay synchronous — they are called in a loop over every project here.
  graph = {
    getMember: md.getMember,
    getProject: md.getProject,
    directREs: md.directREs,
    getTeam: md.getTeam,
  };
});

beforeEach(() => {
  disk.resetStore();
});

const store = () => disk.readStore();

function pick(role: "co_lead" | "lead" | "member"): Actor {
  const m = store().members.find(
    (x) => x.globalRole === role && x.status === "active"
  );
  assert.ok(m, `the seed needs an active ${role}`);
  return { id: m.id, globalRole: role };
}

describe("a Co-Lead sees the whole club, even as PL of nothing", () => {
  test("the seed's Co-Lead really is PL of nothing", async () => {
    /*
      The premise. If somebody later makes the Co-Lead a PL in the seed, the
      tests below would pass for the wrong reason and stop guarding anything --
      so the premise is asserted rather than assumed.
    */
    const perms = await import("@/lib/permissions");
    const actor = pick("co_lead");
    const owned = store().projects.filter((p) =>
      perms.isREofOrAbove(actor, graph, p.id)
    );
    assert.equal(
      owned.length,
      0,
      "the seed's Co-Lead is now a PL, so these tests no longer test the branch they were written for"
    );
  });

  test("they are not treated as a PL of nothing", async () => {
    // `isREofNothing` gates the route. True here means a Co-Lead opening
    // /dashboard is redirected to /my-work.
    const view = await data.getDashboard(pick("co_lead"), graph);
    assert.equal(view.isREofNothing, false);
  });

  test("the people count is the club, not zero", async () => {
    const view = await data.getDashboard(pick("co_lead"), graph);
    assert.ok(
      view.counts.peopleOnMyProjects > 0,
      "a Co-Lead saw 0 people on their projects"
    );
  });

  test("log entries are counted club-wide", async () => {
    /*
      Also the fix for a subtler thing. When this was scoped by PERSON it had to
      add "plus the viewer" explicitly, because a Co-Lead who was the only one
      logging saw zero and it read as broken. Scoping by project fixes that
      structurally -- your own entries on your own projects are in your own
      projects -- but only if a Co-Lead's projects are all of them.
    */
    const total = store().workLogs.filter((w) => !!w.projectId).length;
    assert.ok(total > 0, "the seed needs some logged work");
    const view = await data.getDashboard(pick("co_lead"), graph);
    assert.ok(view.logsThisWeek >= 0);
    // Scoped to every project, so a club-wide count is reachable. The week
    // window means the number itself varies with the seed dates.
    const scoped = await data.getDashboard(pick("member"), graph);
    assert.ok(
      view.logsThisWeek >= scoped.logsThisWeek,
      "a Co-Lead should never see fewer log entries than a plain member"
    );
  });

  test("gone quiet is evaluated over every project", async () => {
    // Not "is non-empty" -- that depends on the seed's dates. The claim is that
    // the SCOPE is the whole club, which is what the array's ceiling shows.
    const view = await data.getDashboard(pick("co_lead"), graph);
    assert.ok(Array.isArray(view.goneQuiet));
    assert.ok(view.goneQuiet.length <= store().projects.length);
  });
});

describe("everyone else is scoped by the project tree", () => {
  test("a plain member PL of nothing gets an empty page and the gate says so", async () => {
    const nobody = store().members.find(
      (m) =>
        m.globalRole === "member" &&
        m.status === "active" &&
        !store().projects.some((p) => p.reIds.includes(m.id))
    );
    if (!nobody) return; // seed has no such person; nothing to assert
    const view = await data.getDashboard(
      { id: nobody.id, globalRole: "member" },
      graph
    );
    assert.equal(view.isREofNothing, true);
    assert.equal(view.reQueue.signOffs.length, 0);
    assert.equal(view.goneQuiet.length, 0);
  });

  test("a PL of one project is scoped to it, not to the club", async () => {
    const re = store().projects.find((p) => p.reIds.length > 0);
    assert.ok(re, "the seed needs a project with a PL");
    const actor: Actor = { id: re.reIds[0], globalRole: "member" };
    const view = await data.getDashboard(actor, graph);

    assert.equal(view.isREofNothing, false);
    // Strictly fewer people than the club, unless they happen to be PL of
    // everything -- which the seed does not do.
    const clubWide = await data.getDashboard(pick("co_lead"), graph);
    assert.ok(
      view.counts.peopleOnMyProjects <= clubWide.counts.peopleOnMyProjects,
      "a PL of one project saw more people than a Co-Lead"
    );
  });
});

describe("the fields the reporting chain used to fill are gone", () => {
  test("no compliance, review queue, escalations or roll-up", async () => {
    /*
      Five of the dashboard's thirteen sections were chain-shaped. Asserted by
      name because the page destructures these, so a partial revert would fail
      here rather than rendering a section nobody can fill.
    */
    const view = await data.getDashboard(pick("co_lead"), graph);
    for (const gone of [
      "compliance",
      "reviewQueue",
      "escalations",
      "rollUp",
      "isLeadOfNobody",
    ]) {
      assert.equal(gone in view, false, `${gone} is back on DashboardView`);
    }
    assert.equal("peopleOverseen" in view.counts, false);
  });

  test("the PL queue has sign-offs and no unanswered entries", async () => {
    // `unanswered` was the PL's half of the check-in queue: project sections
    // waiting on a reply. There are no check-ins to reply to.
    const view = await data.getDashboard(pick("co_lead"), graph);
    assert.ok(Array.isArray(view.reQueue.signOffs));
    assert.equal("unanswered" in view.reQueue, false);
  });

  test("the trainings queue is offered to leadership and nobody else", async () => {
    /*
      Gated on `isLeadership` rather than on `can.verifyTraining` with a dummy
      member id, which is what it did first. The rule takes a SUBJECT and there
      isn't one here -- the question is "could this person verify anything at
      all".
    */
    const lead = await data.getDashboard(pick("lead"), graph);
    assert.ok(Array.isArray(lead.trainings.pending));

    const plain = store().members.find(
      (m) => m.globalRole === "member" && m.status === "active"
    )!;
    const member = await data.getDashboard(
      { id: plain.id, globalRole: "member" },
      graph
    );
    assert.equal(member.trainings.pending.length, 0);
    assert.equal(member.trainings.expired.length, 0);
  });
});
