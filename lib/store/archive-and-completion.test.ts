/**
 * Two rules that both come down to "don't lose the history".
 *
 *   1. A parent project can't be marked complete while anything beneath it is
 *      still running, and completing one announces itself up the chain.
 *   2. A division archives rather than deletes, keeping its projects.
 *
 * Run with:  npm test
 *
 * Separate from `operations.test.ts` only for length — same setup, same rules
 * about import order. `SKYRUNNERS_STORE_DIR` is set BEFORE the store module is
 * imported, because `disk.ts` resolves its path at module scope: a static
 * `import` at the top of this file would bind the developer's real `.data/`
 * directory and the suite would quietly rewrite it.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectPhase } from "../types.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-archive-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";

/**
 * The seed's eVTOL tree, which is what makes the depth tests meaningful:
 *
 *   p-airframe-v2 (div-evtol)
 *     └ p-wing-spar (team-structures)
 *         ├ p-layup (team-composites)
 *         └ p-load-test (team-structures)
 *
 * div-skydelta is the opposite case — one project, no sub-teams — so it's the
 * one used for the plain archive path.
 */
const EVTOL_PROJECTS = [
  "p-layup",
  "p-load-test",
  "p-wing-spar",
  "p-airframe-v2",
  "p-propulsion-test",
];

before(async () => {
  ops = await import("./operations.ts");
  disk = await import("./disk.ts");
});

beforeEach(() => {
  disk.resetStore();
});

process.on("exit", () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort — a leftover temp dir is harmless.
  }
});

/** Change only the phase, leaving every other field as it was. */
async function setPhase(
  projectId: string,
  phase: ProjectPhase,
  actorId = "m-anish"
) {
  const p = disk.readStore().projects.find((x) => x.id === projectId);
  if (!p) throw new Error(`No such project in the seed: ${projectId}`);

  return ops.updateProject({
    projectId,
    name: p.name,
    description: p.description,
    phase,
    health: p.health,
    targetDate: p.targetDate,
    openRoles: p.openRoles,
    actorId,
    today: TODAY,
  });
}

function phaseOf(projectId: string) {
  return disk.readStore().projects.find((p) => p.id === projectId)?.phase;
}

function noticesOn(projectId: string) {
  return disk.readStore().projectNotices.filter((n) => n.projectId === projectId);
}

function teamById(teamId: string) {
  return disk.readStore().teams.find((t) => t.id === teamId);
}

// ---------------------------------------------------------------------------

describe("a parent project cannot finish ahead of its children", () => {
  test("a project with no sub-projects completes freely", async () => {
    assert.equal((await setPhase("p-propulsion-test", "complete")).ok, true);
    assert.equal(phaseOf("p-propulsion-test"), "complete");
  });

  test("a parent with unfinished sub-projects is refused", async () => {
    const result = await setPhase("p-wing-spar", "complete");

    assert.equal(result.ok, false);
    if (!result.ok) {
      // Naming them matters. "Refused" on its own hands the search back to the
      // RE, who then has to expand the tree to find out what's in the way.
      assert.match(result.error, /Layup|Load/i);
    }
  });

  test("the refusal leaves the project untouched", async () => {
    await setPhase("p-wing-spar", "complete");
    assert.equal(phaseOf("p-wing-spar"), "detailed_design");
  });

  test("finishing the children first lets the parent through", async () => {
    assert.equal((await setPhase("p-layup", "complete")).ok, true);
    assert.equal((await setPhase("p-load-test", "complete")).ok, true);
    assert.equal((await setPhase("p-wing-spar", "complete")).ok, true);
  });

  test("it looks all the way down, not just one level", async () => {
    // One direct child complete, a grandchild still open. A one-level check
    // would let this through — which is the bug the whole rule is about.
    await setPhase("p-load-test", "complete");
    const result = await setPhase("p-airframe-v2", "complete");

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Layup|Spar/i);
  });

  test("a grandchild alone is enough to refuse it", async () => {
    /*
      Written straight into the store, because the rule itself makes this state
      unreachable through the API — which is exactly why it needs pinning. Rows
      predating the rule can look like this, and so can anything that reparents
      a project later. A one-level check passes here and shouldn't.
    */
    await ops.deleteProject("p-load-test", true);
    const store = disk.readStore();
    store.projects.find((p) => p.id === "p-wing-spar")!.phase = "complete";

    const result = await setPhase("p-airframe-v2", "complete");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Layup/i);
  });

  test("a cycle in the project tree fails rather than hanging", async () => {
    // `parentId` is a plain column with no constraint against this. An
    // unguarded walk would spin forever and take the request with it.
    const store = disk.readStore();
    store.projects.find((p) => p.id === "p-airframe-v2")!.parentId = "p-layup";

    const result = await setPhase("p-airframe-v2", "complete");
    assert.equal(result.ok, false);
  });

  test("edits that aren't a completion are unaffected by the rule", async () => {
    const result = await ops.updateProject({
      projectId: "p-wing-spar",
      name: "Wing Spar Redesign",
      phase: "detailed_design",
      health: "at_risk",
      actorId: "m-anish",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    assert.equal(
      disk.readStore().projects.find((p) => p.id === "p-wing-spar")?.health,
      "at_risk"
    );
  });

  test("an already-complete project stays editable", async () => {
    await setPhase("p-propulsion-test", "complete");
    // The guard runs on the transition, not on the value — otherwise renaming
    // a finished project would start failing once it had children.
    assert.equal((await setPhase("p-propulsion-test", "complete")).ok, true);
  });
});

describe("completing a project announces it up the chain", () => {
  test("a notice lands in the project's own feed", async () => {
    await setPhase("p-layup", "complete", "m-sofia");
    const notices = noticesOn("p-layup");

    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, "completed");
    assert.equal(notices[0].createdById, "m-sofia");
    assert.match(notices[0].body, /complete/i);
  });

  test("it is NOT written as a check-in", async () => {
    const before = disk.readStore().progressUpdates.length;
    await setPhase("p-layup", "complete", "m-sofia");

    // Synthesising a progress update would have been less code and would have
    // made a member's reliability record claim they reported in on a day they
    // didn't. See `ProjectNotice`.
    assert.equal(disk.readStore().progressUpdates.length, before);
  });

  test("the audience is the REs above it and the leads that own it", async () => {
    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");

    // p-layup sits under p-wing-spar (RE m-tyler) under p-airframe-v2
    // (RE m-priya), owned by team-composites inside div-evtol (lead m-priya).
    assert.ok(notice.notifiedMemberIds.includes("m-tyler"), "parent RE");
    assert.ok(notice.notifiedMemberIds.includes("m-priya"), "division lead");
  });

  test("it stops at the Division Lead — Co-Leads are not told", async () => {
    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");

    // A Co-Lead manages the organisation, not the work. A ping for every set of
    // deliverables that finishes anywhere in the club is exactly the traffic
    // that teaches somebody to stop reading their dashboard.
    assert.ok(
      !notice.notifiedMemberIds.includes("m-anish"),
      "the Co-Lead must not be on a completion notice"
    );
  });

  test("the Division Lead is LAST, after the REs beneath them", async () => {
    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");

    // Nearest first, terminating at the division — the division is the unit
    // that owns delivery, so its lead is the final stop.
    assert.equal(
      notice.notifiedMemberIds[notice.notifiedMemberIds.length - 1],
      "m-priya"
    );
  });

  test("when the Division Lead is the one completing it, it goes to the Co-Leads", async () => {
    // Otherwise the chain terminates on the person who pressed the button and
    // the announcement reaches nobody. m-priya leads div-evtol.
    await setPhase("p-layup", "complete", "m-priya");
    const [notice] = noticesOn("p-layup");

    assert.ok(!notice.notifiedMemberIds.includes("m-priya"));
    assert.equal(
      notice.notifiedMemberIds[notice.notifiedMemberIds.length - 1],
      "m-anish"
    );
  });

  test("a division with no lead falls through to the Co-Leads", async () => {
    // Otherwise the announcement evaporates. A gap in the org chart should
    // surface as the notice landing one level higher, not as silence.
    const store = disk.readStore();
    for (const t of store.teams) {
      if (["div-evtol", "team-structures", "team-composites"].includes(t.id)) {
        t.leadId = undefined;
      }
    }
    // Strip the ancestor REs too, so only the fallback can produce a recipient.
    for (const p of store.projects) {
      if (["p-wing-spar", "p-airframe-v2"].includes(p.id)) {
        p.primaryReId = "m-sofia";
        p.reIds = ["m-sofia"];
      }
    }

    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");
    assert.deepEqual(notice.notifiedMemberIds, ["m-anish"]);
  });

  test("the person who did it isn't told about their own action", async () => {
    await setPhase("p-layup", "complete", "m-tyler"); // an RE one level up
    const [notice] = noticesOn("p-layup");
    assert.ok(!notice.notifiedMemberIds.includes("m-tyler"));
  });

  test("nobody appears twice, however many routes reach them", async () => {
    // m-priya is both the parent project's RE and the division lead.
    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");

    assert.equal(
      notice.notifiedMemberIds.length,
      new Set(notice.notifiedMemberIds).size
    );
  });

  test("saving again while already complete doesn't announce twice", async () => {
    await setPhase("p-propulsion-test", "complete");
    await setPhase("p-propulsion-test", "complete");
    assert.equal(noticesOn("p-propulsion-test").length, 1);
  });

  test("reopening is announced too", async () => {
    await setPhase("p-propulsion-test", "complete");
    await setPhase("p-propulsion-test", "testing");

    const notices = noticesOn("p-propulsion-test");
    assert.equal(notices.length, 2);
    assert.equal(notices[1].kind, "reopened");
  });

  test("deleting a project takes its notices with it", async () => {
    await setPhase("p-propulsion-test", "complete");
    assert.equal((await ops.deleteProject("p-propulsion-test", true)).ok, true);
    assert.equal(noticesOn("p-propulsion-test").length, 0);
  });
});

// ---------------------------------------------------------------------------

describe("archiving a division keeps its history", () => {
  test("a division whose work is finished can be archived", async () => {
    await setPhase("p-skydelta-concept", "complete");
    const result = await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      note: "Folded into eVTOL.",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    const team = teamById("div-skydelta");
    assert.equal(team?.isActive, false);
    assert.equal(team?.archivedAt, TODAY);
    assert.equal(team?.archivedBy, "m-anish");
    assert.equal(team?.archiveNote, "Folded into eVTOL.");
  });

  test("its projects stay exactly where they were — that IS the archive", async () => {
    await setPhase("p-skydelta-concept", "complete");
    await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      today: TODAY,
    });

    const project = disk
      .readStore()
      .projects.find((p) => p.id === "p-skydelta-concept");

    // The old `deleteTeam` required moving these away first, which is how
    // retiring a division came to mean erasing what it built.
    assert.ok(project, "the project must survive archiving");
    assert.equal(project?.teamId, "div-skydelta");
  });

  test("live work blocks it, and the message names what", async () => {
    // p-skydelta-concept is still at `concept` in the seed.
    const result = await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      today: TODAY,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /still running/i);
    assert.equal(teamById("div-skydelta")?.isActive, true);
  });

  test("live work in a SUB-team blocks it too", async () => {
    // div-evtol → team-structures → team-composites, all with running work.
    // Checking only the division's own projects would hide three teams' worth.
    const result = await ops.archiveTeam({
      teamId: "div-evtol",
      archivedBy: "m-anish",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("sub-teams go with the parent", async () => {
    for (const id of EVTOL_PROJECTS) {
      assert.equal((await setPhase(id, "complete")).ok, true, `completing ${id}`);
    }

    assert.equal(
      (
        await ops.archiveTeam({
          teamId: "div-evtol",
          archivedBy: "m-anish",
          today: TODAY,
        })
      ).ok,
      true
    );

    for (const id of ["team-structures", "team-composites", "team-propulsion"]) {
      assert.equal(teamById(id)?.isActive, false, id);
    }
  });

  test("archiving the same division twice is refused", async () => {
    await setPhase("p-skydelta-concept", "complete");
    await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      today: TODAY,
    });

    const again = await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      today: TODAY,
    });
    assert.equal(again.ok, false);
  });

  test("an unknown division fails rather than throwing", async () => {
    const result = await ops.archiveTeam({
      teamId: "not-a-real-team",
      archivedBy: "m-anish",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });
});

describe("restoring a division", () => {
  test("it comes back and the archive fields are cleared", async () => {
    await setPhase("p-skydelta-concept", "complete");
    await ops.archiveTeam({
      teamId: "div-skydelta",
      archivedBy: "m-anish",
      note: "Folded in.",
      today: TODAY,
    });

    assert.equal((await ops.restoreTeam("div-skydelta")).ok, true);

    const team = teamById("div-skydelta");
    assert.equal(team?.isActive, true);
    assert.equal(team?.archivedAt, undefined);
    assert.equal(team?.archivedBy, undefined);
    assert.equal(team?.archiveNote, undefined);
  });

  test("restoring an active division is refused", async () => {
    assert.equal((await ops.restoreTeam("div-skydelta")).ok, false);
  });

  test("a sub-team can't come back before its parent", async () => {
    for (const id of EVTOL_PROJECTS) await setPhase(id, "complete");
    await ops.archiveTeam({
      teamId: "div-evtol",
      archivedBy: "m-anish",
      today: TODAY,
    });

    // Active with nowhere to appear is worse than archived.
    const early = await ops.restoreTeam("team-structures");
    assert.equal(early.ok, false);
    if (!early.ok) assert.match(early.error, /eVTOL/i);

    assert.equal((await ops.restoreTeam("div-evtol")).ok, true);
    assert.equal((await ops.restoreTeam("team-structures")).ok, true);
  });
});

describe("editing a division", () => {
  test("leaving leadId out keeps the existing lead", async () => {
    const result = await ops.updateTeam({
      teamId: "div-evtol",
      name: "Fixed Wing eVTOL",
      parentId: null,
    });

    assert.equal(result.ok, true);
    // The bug this pins: the edit form had no lead field, so every rename
    // posted an empty value and silently cleared the Division Lead. The name
    // just stopped appearing on /projects.
    assert.equal(teamById("div-evtol")?.leadId, "m-priya");
  });

  test("an explicit null clears it", async () => {
    await ops.updateTeam({
      teamId: "div-evtol",
      name: "Fixed Wing eVTOL",
      parentId: null,
      leadId: null,
    });
    assert.equal(teamById("div-evtol")?.leadId, undefined);
  });

  test("a team cannot be moved inside its own sub-team", async () => {
    // div-evtol → team-structures → team-composites. Putting div-evtol under
    // team-composites strands all three, and every tree walk in the app would
    // then be relying on its own cycle guard.
    const result = await ops.updateTeam({
      teamId: "div-evtol",
      name: "Fixed Wing eVTOL",
      parentId: "team-composites",
    });
    assert.equal(result.ok, false);
  });

  test("a team still cannot be its own parent", async () => {
    const result = await ops.updateTeam({
      teamId: "div-evtol",
      name: "Fixed Wing eVTOL",
      parentId: "div-evtol",
    });
    assert.equal(result.ok, false);
  });
});
