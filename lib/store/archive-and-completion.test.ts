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
  return disk
    .readStore()
    .projectNotices.filter((n) => n.projectId === projectId);
}

function teamById(teamId: string) {
  return disk.readStore().teams.find((t) => t.id === teamId);
}

// ---------------------------------------------------------------------------

/*
  The contract `setProjectPhaseAction` depends on.

  That action backs the inline phase control on a project page, and it works
  exactly like `setPhase` above: read the row, change one field, hand the rest
  back unchanged. Which means the two tests below are the ones that would catch
  the control silently eating a project's description.

  Worth stating why the action cannot just reuse `updateProjectAction`: that one
  reads every field out of a FormData, so a control posting only `phase` submits
  an empty name and undefined everything else.
*/
describe("a phase-only change leaves the rest of the project alone", () => {
  test("name, description, target date, open roles and health all survive", async () => {
    const before = disk
      .readStore()
      .projects.find((p) => p.id === "p-wing-spar")!;

    assert.equal((await setPhase("p-wing-spar", "integration")).ok, true);

    const after = disk
      .readStore()
      .projects.find((p) => p.id === "p-wing-spar")!;
    assert.equal(after.phase, "integration", "the phase moved");
    assert.equal(after.name, before.name);
    assert.equal(after.description, before.description);
    assert.equal(after.targetDate, before.targetDate);
    assert.equal(after.openRoles, before.openRoles);
    assert.equal(after.health, before.health, "health is a different field");
  });

  /*
    The guard that makes a forgotten field LOUD.

    If the inline control ever stops passing the name through, this refusal is
    what turns it into "the control doesn't work" rather than "the project's
    description quietly vanished". Silent data loss is the failure worth paying
    a validation error to avoid.
  */
  test("an empty name is refused, so a partial submit cannot erase anything", async () => {
    const before = disk
      .readStore()
      .projects.find((p) => p.id === "p-wing-spar")!;

    const result = await ops.updateProject({
      projectId: "p-wing-spar",
      name: "",
      phase: "integration",
      health: before.health,
      today: TODAY,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /name/i);

    const after = disk
      .readStore()
      .projects.find((p) => p.id === "p-wing-spar")!;
    assert.equal(after.description, before.description, "nothing was written");
    assert.equal(after.targetDate, before.targetDate);
    assert.equal(after.phase, before.phase);
  });
});

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
      // PL, who then has to expand the tree to find out what's in the way.
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

  test("the audience is the PLs above it and the leads that own it", async () => {
    await setPhase("p-layup", "complete", "m-sofia");
    const [notice] = noticesOn("p-layup");

    // p-layup sits under p-wing-spar (PL m-tyler) under p-airframe-v2
    // (PL m-priya), owned by team-composites inside div-evtol (lead m-priya).
    assert.ok(notice.notifiedMemberIds.includes("m-tyler"), "parent PL");
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

  test("the Division Lead is LAST, after the PLs beneath them", async () => {
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
    // Strip the ancestor PLs too, so only the fallback can produce a recipient.
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
    await setPhase("p-layup", "complete", "m-tyler"); // a PL one level up
    const [notice] = noticesOn("p-layup");
    assert.ok(!notice.notifiedMemberIds.includes("m-tyler"));
  });

  test("nobody appears twice, however many routes reach them", async () => {
    // m-priya is both the parent project's PL and the division lead.
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
      assert.equal(
        (await setPhase(id, "complete")).ok,
        true,
        `completing ${id}`
      );
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

    for (const id of [
      "team-structures",
      "team-composites",
      "team-propulsion",
    ]) {
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

// ---------------------------------------------------------------------------
// Phase 5 — the academic calendar
// ---------------------------------------------------------------------------

describe("the academic calendar", () => {
  /*
    The seed calendar, for reference:
      Summer 2026    2026-06-15 → 2026-09-20   no obligations
      Autumn 2026    2026-09-21 → 2026-12-04   obligations
      Autumn finals  2026-12-05 → 2026-12-12   no obligations
      Winter break   2026-12-13 → 2027-01-04   no obligations
      Winter 2027    2027-01-05 → 2027-03-19   obligations
  */
  function termNamed(name: string) {
    return disk.readStore().terms.find((t) => t.name === name);
  }

  /** Same lookup, but for the cases that would be meaningless if it missed. */
  function requireTerm(name: string) {
    const found = termNamed(name);
    if (!found) throw new Error(`No such term in the seed: ${name}`);
    return found;
  }

  test("a quarter generates obligations by default", async () => {
    const result = await ops.createTerm({
      name: "Spring 2027",
      kind: "quarter",
      startsOn: "2027-03-29",
      endsOn: "2027-06-09",
    });

    assert.equal(result.ok, true);
    assert.equal(termNamed("Spring 2027")?.generatesObligations, true);
  });

  test("finals, breaks and summer do not", async () => {
    const kinds = [
      ["finals", "Spring finals"],
      ["break", "Spring break"],
      ["summer", "Summer 2027"],
    ] as const;

    // The mistake this default exists to prevent is a finals week that still
    // generates check-ins — nudges landing on students mid-finals.
    let cursor = 20;
    for (const [kind, name] of kinds) {
      const result = await ops.createTerm({
        name,
        kind,
        startsOn: `2027-06-${cursor}`,
        endsOn: `2027-06-${cursor + 2}`,
      });
      assert.equal(result.ok, true, name);
      assert.equal(termNamed(name)?.generatesObligations, false, name);
      cursor += 4;
    }
  });

  test("the default can be overridden deliberately", async () => {
    const result = await ops.createTerm({
      name: "Summer build",
      kind: "summer",
      startsOn: "2027-07-01",
      endsOn: "2027-08-31",
      generatesObligations: true,
    });
    assert.equal(result.ok, true);
    assert.equal(termNamed("Summer build")?.generatesObligations, true);
  });

  test("overlapping periods are refused, and the message names the clash", async () => {
    // `termFor(date)` returns the FIRST match, so two periods covering one day
    // would make "are check-ins due today" depend on insertion order.
    const result = await ops.createTerm({
      name: "Overlaps autumn",
      kind: "quarter",
      startsOn: "2026-12-01",
      endsOn: "2026-12-20",
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Autumn/i);
  });

  test("touching but not overlapping is fine", async () => {
    // Winter 2027 ends 2027-03-19. Starting on the 20th must be allowed, or
    // the calendar can never be filled in without gaps.
    const result = await ops.createTerm({
      name: "Day after winter",
      kind: "break",
      startsOn: "2027-03-20",
      endsOn: "2027-03-28",
    });
    assert.equal(result.ok, true);
  });

  test("an end before the start is refused", async () => {
    const result = await ops.createTerm({
      name: "Backwards",
      kind: "quarter",
      startsOn: "2027-05-01",
      endsOn: "2027-04-01",
    });
    assert.equal(result.ok, false);
  });

  test("a nameless period is refused", async () => {
    const result = await ops.createTerm({
      name: "   ",
      kind: "quarter",
      startsOn: "2027-05-01",
      endsOn: "2027-06-01",
    });
    assert.equal(result.ok, false);
  });

  test("editing a period can keep its own dates", async () => {
    // The overlap check has to ignore the row being edited, or renaming a term
    // without touching its dates would fail against itself.
    const autumn = requireTerm("Autumn 2026");
    const result = await ops.updateTerm({
      termId: autumn.id,
      name: "Autumn Quarter 2026",
      kind: "quarter",
      startsOn: autumn.startsOn,
      endsOn: autumn.endsOn,
    });

    assert.equal(result.ok, true);
    assert.equal(termNamed("Autumn Quarter 2026")?.startsOn, autumn.startsOn);
  });

  test("editing into somebody else's dates is still refused", async () => {
    const autumn = requireTerm("Autumn 2026");
    const result = await ops.updateTerm({
      termId: autumn.id,
      name: "Autumn 2026",
      kind: "quarter",
      startsOn: "2026-12-01",
      endsOn: "2026-12-31", // runs over finals and into the break
    });
    assert.equal(result.ok, false);
  });

  test("the period covering today cannot be deleted", async () => {
    // Removing it would move everyone's obligations with no visible cause.
    const summer = requireTerm("Summer 2026");
    const result = await ops.deleteTerm(summer.id, "2026-08-10");

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /covers today/i);
  });

  test("any other period can be", async () => {
    const winter = requireTerm("Winter 2027");
    assert.equal((await ops.deleteTerm(winter.id, "2026-08-10")).ok, true);
    assert.equal(termNamed("Winter 2027"), undefined);
  });

  test("an unknown id fails rather than throwing", async () => {
    assert.equal((await ops.deleteTerm("nope", "2026-08-10")).ok, false);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — the blocker board
// ---------------------------------------------------------------------------

describe("asking for help", () => {
  const ASKER = "m-tyler";
  const HELPER = "m-sofia";

  async function ask(title = "Need an Onshape hand", projectId?: string) {
    const result = await ops.postHelpRequest({
      memberId: ASKER,
      title,
      detail: "Mate constraints keep over-defining.",
      projectId,
      today: TODAY,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  function stored(id: string) {
    return disk.readStore().helpRequests.find((h) => h.id === id);
  }

  test("anyone can post one, with no project", async () => {
    // The case the board exists for: a member waiting on a join request has
    // nowhere else to put a question.
    const request = await ask();
    assert.equal(stored(request.id)?.title, "Need an Onshape hand");
    assert.equal(stored(request.id)?.projectId, undefined);
  });

  test("it can be attached to a project", async () => {
    const request = await ask("CFD question", "p-wing-spar");
    assert.equal(stored(request.id)?.projectId, "p-wing-spar");
  });

  test("a project that doesn't exist is refused", async () => {
    const result = await ops.postHelpRequest({
      memberId: ASKER,
      title: "Question",
      projectId: "not-a-project",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("an empty title is refused", async () => {
    const result = await ops.postHelpRequest({
      memberId: ASKER,
      title: "   ",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("a title longer than a line is refused", async () => {
    // The title is what people scan on the board; past a line it stops being
    // scannable and the detail field is right there.
    const result = await ops.postHelpRequest({
      memberId: ASKER,
      title: "x".repeat(161),
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("somebody else can answer it", async () => {
    const request = await ask();
    const result = await ops.replyToHelpRequest({
      requestId: request.id,
      memberId: HELPER,
      body: "Fully define the sketch first.",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    assert.equal(stored(request.id)?.replies.length, 1);
    assert.equal(stored(request.id)?.replies[0].memberId, HELPER);
  });

  test("an empty answer is refused", async () => {
    const request = await ask();
    const result = await ops.replyToHelpRequest({
      requestId: request.id,
      memberId: HELPER,
      body: "  ",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("resolving records who and how", async () => {
    const request = await ask();
    const result = await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: HELPER,
      note: "Sofia walked me through it.",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    const saved = stored(request.id);
    assert.equal(saved?.resolvedAt, TODAY);
    assert.equal(saved?.resolvedById, HELPER);
    assert.equal(saved?.resolutionNote, "Sofia walked me through it.");
  });

  test("a resolved ask is kept, not deleted", async () => {
    // The note on how it got sorted is the useful half — it's how the next
    // person with the same problem finds the answer.
    const request = await ask();
    await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: HELPER,
      today: TODAY,
    });
    assert.ok(stored(request.id), "the row must survive being resolved");
  });

  test("answering a sorted one is refused", async () => {
    const request = await ask();
    await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: HELPER,
      today: TODAY,
    });

    const result = await ops.replyToHelpRequest({
      requestId: request.id,
      memberId: HELPER,
      body: "One more thing",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("resolving twice is refused", async () => {
    const request = await ask();
    await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: HELPER,
      today: TODAY,
    });
    const again = await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: ASKER,
      today: TODAY,
    });
    assert.equal(again.ok, false);
  });

  test("reopening clears the resolution", async () => {
    const request = await ask();
    await ops.resolveHelpRequest({
      requestId: request.id,
      resolvedById: HELPER,
      note: "Sorted",
      today: TODAY,
    });

    assert.equal((await ops.reopenHelpRequest(request.id)).ok, true);
    const saved = stored(request.id);
    assert.equal(saved?.resolvedAt, undefined);
    assert.equal(saved?.resolvedById, undefined);
    assert.equal(saved?.resolutionNote, undefined);
  });

  test("deleting takes the replies with it", async () => {
    const request = await ask();
    await ops.replyToHelpRequest({
      requestId: request.id,
      memberId: HELPER,
      body: "Try this",
      today: TODAY,
    });

    assert.equal((await ops.deleteHelpRequest(request.id)).ok, true);
    assert.equal(stored(request.id), undefined);
  });

  test("unknown ids fail rather than throwing", async () => {
    assert.equal((await ops.reopenHelpRequest("nope")).ok, false);
    assert.equal((await ops.deleteHelpRequest("nope")).ok, false);
    assert.equal(
      (
        await ops.resolveHelpRequest({
          requestId: "nope",
          resolvedById: HELPER,
          today: TODAY,
        })
      ).ok,
      false
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — the PL answers a check-in, section by section
// ---------------------------------------------------------------------------

describe("the PL answers a check-in section", () => {
  const PL = "m-tyler";

  function entry(id: string) {
    for (const u of disk.readStore().progressUpdates) {
      const found = u.entries.find((e) => e.id === id);
      if (found) return found;
    }
    return undefined;
  }

  test("a reply is stored against the section, with who and when", async () => {
    const result = await ops.respondToUpdateEntry({
      entryId: "ue-1",
      responderId: PL,
      response: "Ordering a new seal — carry on with dry layups meanwhile.",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    const saved = entry("ue-1");
    assert.match(saved?.response ?? "", /Ordering a new seal/);
    assert.equal(saved?.respondedBy, PL);
    assert.equal(saved?.respondedAt, TODAY);
  });

  test("it lands on that section only, not the whole check-in", async () => {
    // The entire reason `update_entries` is per-project: a member on three
    // projects gets three answers from three different PLs.
    await ops.respondToUpdateEntry({
      entryId: "ue-2",
      responderId: PL,
      response: "Agreed, park it until the coupons are back.",
      today: TODAY,
    });

    assert.ok(entry("ue-2")?.response);
    assert.equal(entry("ue-3")?.response, undefined);
  });

  test("it is NOT recorded as the Lead having read the check-in", async () => {
    // Reading and answering are two obligations belonging to two people.
    // Collapsing them would let a PL's reply silently clear a Lead's queue.
    await ops.respondToUpdateEntry({
      entryId: "ue-1",
      responderId: PL,
      response: "On it.",
      today: TODAY,
    });

    const update = disk.readStore().progressUpdates.find((u) => u.id === "u-1");
    assert.equal(update?.reviewedAt, undefined);
    assert.equal(update?.status !== "reviewed", true);
  });

  test("an empty body clears a reply rather than storing nothing", async () => {
    await ops.respondToUpdateEntry({
      entryId: "ue-1",
      responderId: PL,
      response: "Wrong section, sorry.",
      today: TODAY,
    });
    assert.ok(entry("ue-1")?.response);

    await ops.respondToUpdateEntry({
      entryId: "ue-1",
      responderId: PL,
      response: "   ",
      today: TODAY,
    });

    const saved = entry("ue-1");
    assert.equal(saved?.response, undefined);
    assert.equal(saved?.respondedBy, undefined);
    assert.equal(saved?.respondedAt, undefined);
  });

  test("a draft check-in cannot be answered", async () => {
    // Replying to something the member hasn't sent yet means the text can
    // still change underneath the reply.
    const store = disk.readStore();
    const draft = store.progressUpdates.find((u) => !u.submittedAt);
    if (!draft?.entries[0]) return; // no draft in the seed — nothing to assert

    const result = await ops.respondToUpdateEntry({
      entryId: draft.entries[0].id,
      responderId: PL,
      response: "Too early",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });

  test("an unknown section fails rather than throwing", async () => {
    const result = await ops.respondToUpdateEntry({
      entryId: "not-an-entry",
      responderId: PL,
      response: "Hello",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// Deleting a member record
// ---------------------------------------------------------------------------

describe("deleting a member record", () => {
  const CO_LEAD = "m-anish";

  function memberById(id: string) {
    return disk.readStore().members.find((m) => m.id === id);
  }

  /** A row with no history — the duplicate-profile case this exists for. */
  async function freshMember(email = "julia@stanford.edu") {
    const result = await ops.inviteMember({
      email,
      fullName: "Julia Hale",
      globalRole: "member",
      today: TODAY,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  test("a record with no history deletes cleanly", async () => {
    const julia = await freshMember();
    const result = await ops.deleteMember({
      memberId: julia.id,
      actorId: CO_LEAD,
    });

    assert.equal(result.ok, true);
    assert.equal(memberById(julia.id), undefined);
  });

  /*
    "their check-in schedule goes with them" was a test here, asserting that
    `deleteMember` cleared the row `inviteMember` created in `update_schedules`.
    Neither side of that exists: invites stopped seeding a schedule and the app
    stopped loading the table when check-ins went on 2026-08-24.

    The invariant it was protecting is still tested by the rows above and below
    it -- deleting a member must not leave a row pointing at nobody -- and it
    still holds for work logs, memberships, join requests, certifications, help
    requests and deliverables.
  */

  test("you can't delete yourself", async () => {
    const result = await ops.deleteMember({
      memberId: CO_LEAD,
      actorId: CO_LEAD,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /your own account/i);
  });

  test("the last Co-Lead can't be deleted", async () => {
    // A lock-out guard, not a caution — `force` must not bypass it.
    const store = disk.readStore();
    for (const m of store.members) {
      if (m.globalRole === "co_lead" && m.id !== CO_LEAD) m.globalRole = "lead";
    }

    const result = await ops.deleteMember({
      memberId: CO_LEAD,
      actorId: "m-priya",
      force: true,
    });
    assert.equal(result.ok, false);
  });

  test("somebody with real history is refused, and told what", async () => {
    // m-sofia has a submitted check-in in the seed.
    const result = await ops.deleteMember({
      memberId: "m-sofia",
      actorId: CO_LEAD,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /check-in|deliverable/i);
      // The message has to point at the right tool, or somebody forces it.
      assert.match(result.error, /Deactivate/i);
    }
    assert.ok(memberById("m-sofia"));
  });

  test("a Co-Lead can force past the history guard", async () => {
    // The duplicate-profile case: the row looks real but isn't.
    const store = disk.readStore();
    // Sofia is the primary PL of p-layup, which is refused separately — hand
    // it over first so this test exercises the history guard alone.
    const layup = store.projects.find((p) => p.id === "p-layup")!;
    layup.primaryReId = CO_LEAD;
    layup.reIds = [CO_LEAD];

    const result = await ops.deleteMember({
      memberId: "m-sofia",
      actorId: CO_LEAD,
      force: true,
    });

    assert.equal(result.ok, true);
    assert.equal(memberById("m-sofia"), undefined);
  });

  test("being a primary PL blocks it, even forced", async () => {
    // A project with no PL is the one state the model can't represent, so this
    // refuses rather than guessing a replacement.
    const result = await ops.deleteMember({
      memberId: "m-tyler",
      actorId: CO_LEAD,
      force: true,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /primary PL/i);
  });

  test("no row is left pointing at the deleted one", async () => {
    /*
      This asserted that reports moved UP a level, because a member whose
      `leadId` pointed at a deleted row had nobody reading their check-ins and
      no escalation path.

      The chain went on 2026-08-24 and nothing reads `leadId` now, so the
      "moves up" half is no longer a behaviour anybody depends on. What still
      matters is the half underneath it: `profiles.lead_id` REFERENCES
      `profiles(id)`, so leaving a pointer to a deleted row is a dangling
      foreign key, and in Postgres it is a constraint violation rather than a
      quiet inconsistency. Kept for that reason, and asserted as that.

      Julia is invited with no Lead now (invites stopped setting one), so
      Tyler's line lands on null rather than on the Co-Lead.
    */
    const julia = await freshMember();
    const store = disk.readStore();
    store.members.find((m) => m.id === "m-tyler")!.leadId = julia.id;

    await ops.deleteMember({ memberId: julia.id, actorId: CO_LEAD });

    assert.notEqual(memberById("m-tyler")?.leadId, julia.id);
    assert.equal(memberById("m-tyler")?.leadId, null);
  });

  test("a division they led is left without a lead, not pointing at a ghost", async () => {
    const julia = await freshMember();
    const store = disk.readStore();
    store.teams.find((t) => t.id === "div-skydelta")!.leadId = julia.id;

    await ops.deleteMember({ memberId: julia.id, actorId: CO_LEAD });

    assert.equal(
      disk.readStore().teams.find((t) => t.id === "div-skydelta")?.leadId,
      undefined
    );
  });

  test("an unknown id fails rather than throwing", async () => {
    const result = await ops.deleteMember({
      memberId: "nope",
      actorId: CO_LEAD,
    });
    assert.equal(result.ok, false);
  });

  test("a refused delete leaves reporting lines untouched", async () => {
    /*
      The primary-PL check used to run AFTER the reparenting loop, so a delete
      that was then refused had already rewritten everybody's Lead. A failed
      operation with a permanent side effect is the worst kind — the caller
      sees an error and reasonably assumes nothing changed.
    */
    disk.readStore().members.find((m) => m.id === "m-sofia")!.leadId =
      "m-tyler";

    // m-tyler is the primary PL of p-wing-spar, so this is refused.
    const result = await ops.deleteMember({
      memberId: "m-tyler",
      actorId: CO_LEAD,
      force: true,
    });
    assert.equal(result.ok, false);

    // Still reporting to Tyler, not silently moved up to his Lead.
    assert.equal(
      disk.readStore().members.find((m) => m.id === "m-sofia")?.leadId,
      "m-tyler"
    );
  });
});

// ---------------------------------------------------------------------------
// Nested due dates
// ---------------------------------------------------------------------------

/** Change only the target date, leaving every other field as it was. */
async function setTarget(projectId: string, targetDate?: string) {
  const p = disk.readStore().projects.find((x) => x.id === projectId);
  if (!p) throw new Error(`No such project in the seed: ${projectId}`);

  return ops.updateProject({
    projectId,
    name: p.name,
    description: p.description,
    phase: p.phase,
    health: p.health,
    targetDate,
    openRoles: p.openRoles,
    actorId: "m-anish",
    today: TODAY,
  });
}

function targetOf(projectId: string) {
  return disk.readStore().projects.find((p) => p.id === projectId)?.targetDate;
}

describe("work inside a project can't be due after the project", () => {
  /*
    The seed's dates, which the tests below lean on:

      p-airframe-v2   2026-12-15
        └ p-wing-spar   2026-10-30
            ├ p-layup     2026-08-30
            └ p-load-test 2026-10-15
  */

  test("the seed itself satisfies the rule", () => {
    // If this fails, the sample club ships in violation of its own constraint
    // and every date edit below is testing a fiction.
    assert.ok(targetOf("p-layup")! <= targetOf("p-wing-spar")!);
    assert.ok(targetOf("p-load-test")! <= targetOf("p-wing-spar")!);
    assert.ok(targetOf("p-wing-spar")! <= targetOf("p-airframe-v2")!);
  });

  test("a child dated after its parent is refused", async () => {
    const result = await setTarget("p-load-test", "2026-11-30");

    assert.equal(result.ok, false);
    if (!result.ok) {
      // Names the parent and its date — otherwise the PL has to go and look.
      assert.match(result.error, /Wing Spar/i);
      assert.match(result.error, /2026-10-30/);
    }
    assert.equal(targetOf("p-load-test"), "2026-10-15");
  });

  test("a child dated on the parent's date exactly is fine", async () => {
    assert.equal((await setTarget("p-load-test", "2026-10-30")).ok, true);
    assert.equal(targetOf("p-load-test"), "2026-10-30");
  });

  test("pulling a parent in over a later child is refused too", async () => {
    // The same mistake arriving from the other direction.
    const result = await setTarget("p-wing-spar", "2026-09-01");

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Load Test/i);
    assert.equal(targetOf("p-wing-spar"), "2026-10-30");
  });

  test("the check reaches grandchildren, not just direct children", async () => {
    // p-layup is two levels under p-airframe-v2.
    assert.equal((await setTarget("p-layup", "2026-10-20")).ok, true);
    const result = await setTarget("p-airframe-v2", "2026-09-15");

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Layup|Spar|Load/i);
  });

  test("no parent date means no constraint", async () => {
    assert.equal((await setTarget("p-airframe-v2", undefined)).ok, true);
    // Far past where the parent used to be. An undated parent promises nothing,
    // so there is nothing to be late for.
    assert.equal((await setTarget("p-wing-spar", "2027-06-01")).ok, true);
    assert.equal(targetOf("p-wing-spar"), "2027-06-01");
  });

  test("clearing a child's date is always allowed", async () => {
    assert.equal((await setTarget("p-load-test", undefined)).ok, true);
    assert.equal(targetOf("p-load-test"), undefined);
  });

  test("a top-level project takes any date", async () => {
    assert.equal((await setTarget("p-propulsion-test", "2029-01-01")).ok, true);
  });

  test("an unrelated edit still saves when the dates already clash", async () => {
    /*
      The regression this guards.

      Dates entered before the rule existed would otherwise freeze the project:
      every save resends the existing date, so a rename would fail on a
      violation the person never touched and could not see.
    */
    const store = disk.readStore();
    const spar = store.projects.find((p) => p.id === "p-wing-spar")!;
    const loadTest = store.projects.find((p) => p.id === "p-load-test")!;
    // Reach past the operation to create the illegal pair, exactly as old data
    // would arrive.
    await ops.updateProject({
      projectId: "p-wing-spar",
      name: spar.name,
      phase: spar.phase,
      health: spar.health,
      targetDate: "2026-12-01",
      actorId: "m-anish",
      today: TODAY,
    });
    await ops.updateProject({
      projectId: "p-load-test",
      name: loadTest.name,
      phase: loadTest.phase,
      health: loadTest.health,
      targetDate: "2026-12-01",
      actorId: "m-anish",
      today: TODAY,
    });
    // Now pull the parent in, bypassing the check by leaving the date alone…
    disk.readStore().projects.find((p) => p.id === "p-wing-spar")!.targetDate =
      "2026-09-01";

    const renamed = await ops.updateProject({
      projectId: "p-load-test",
      name: "Load Test (renamed)",
      phase: loadTest.phase,
      health: loadTest.health,
      targetDate: "2026-12-01",
      actorId: "m-anish",
      today: TODAY,
    });

    assert.equal(renamed.ok, true);
    assert.equal(
      disk.readStore().projects.find((p) => p.id === "p-load-test")?.name,
      "Load Test (renamed)"
    );
  });
});

// ---------------------------------------------------------------------------
// Taking a sign-off back
// ---------------------------------------------------------------------------

describe("withdrawing a sign-off", () => {
  /** Sign something off so there's an approval to overturn. */
  async function signOffSomethingOn(projectId: string) {
    const d = disk
      .readStore()
      .deliverables.find((x) => x.projectId === projectId);
    if (!d) throw new Error(`No deliverable on ${projectId} in the seed`);
    await ops.confirmDeliverable(d.id, "m-tyler", TODAY);
    return d.id;
  }

  function deliverable(id: string) {
    return disk.readStore().deliverables.find((d) => d.id === id)!;
  }

  test("a completed deliverable goes back to in progress with the reason", async () => {
    const id = await signOffSomethingOn("p-wing-spar");
    assert.equal(deliverable(id).status, "done");

    const result = await ops.withdrawSignOff({
      deliverableId: id,
      reason: "Failed at 1.3g on the bench.",
      actorId: "m-priya",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    const after = deliverable(id);
    assert.equal(after.status, "in_progress");
    assert.equal(after.completedAt, undefined);
    assert.equal(after.confirmedById, undefined);
    assert.match(after.blockerNote ?? "", /1\.3g/);
  });

  test("a reason is required — this comes off somebody's record", async () => {
    const id = await signOffSomethingOn("p-wing-spar");
    const result = await ops.withdrawSignOff({
      deliverableId: id,
      reason: "   ",
      actorId: "m-priya",
      today: TODAY,
    });

    assert.equal(result.ok, false);
    assert.equal(deliverable(id).status, "done");
  });

  test("something that was never signed off is refused", async () => {
    const open = disk
      .readStore()
      .deliverables.find((d) => d.status !== "done")!;

    const result = await ops.withdrawSignOff({
      deliverableId: open.id,
      reason: "Doesn't meet the requirement.",
      actorId: "m-priya",
      today: TODAY,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Send it back/i);
  });

  test("a complete project is reopened, because both can't be true", async () => {
    // p-propulsion-test has no children, so it completes freely.
    assert.equal((await setPhase("p-propulsion-test", "complete")).ok, true);
    const id = await signOffSomethingOn("p-propulsion-test");

    const before = noticesOn("p-propulsion-test").length;
    const result = await ops.withdrawSignOff({
      deliverableId: id,
      reason: "The mount cracked.",
      actorId: "m-priya",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    assert.notEqual(phaseOf("p-propulsion-test"), "complete");
    assert.equal(
      disk.readStore().projects.find((p) => p.id === "p-propulsion-test")
        ?.health,
      "at_risk"
    );

    // And the people who were told it was finished are told it isn't.
    const notices = noticesOn("p-propulsion-test");
    assert.equal(notices.length, before + 1);
    const latest = notices[notices.length - 1];
    assert.equal(latest.kind, "reopened");
    assert.match(latest.body, /mount cracked/i);
    assert.ok(latest.notifiedMemberIds.length > 0);
  });

  test("an active project is left alone — only the deliverable moves", async () => {
    const id = await signOffSomethingOn("p-wing-spar");
    const phaseBefore = phaseOf("p-wing-spar");
    const noticesBefore = noticesOn("p-wing-spar").length;

    await ops.withdrawSignOff({
      deliverableId: id,
      reason: "Wrong layup schedule.",
      actorId: "m-priya",
      today: TODAY,
    });

    assert.equal(phaseOf("p-wing-spar"), phaseBefore);
    assert.equal(noticesOn("p-wing-spar").length, noticesBefore);
  });

  test("an unknown id fails rather than throwing", async () => {
    const result = await ops.withdrawSignOff({
      deliverableId: "d-nope",
      reason: "Whatever.",
      actorId: "m-priya",
      today: TODAY,
    });
    assert.equal(result.ok, false);
  });
});

describe("a new sub-project can't be created past its parent's date", () => {
  test("refused on the way in", async () => {
    const result = await ops.createProject({
      name: "Late Sub",
      parentId: "p-wing-spar", // due 2026-10-30
      primaryReId: "m-tyler",
      targetDate: "2026-12-01",
      createdBy: "m-anish",
      today: TODAY,
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /2026-10-30/);
  });

  test("on or before the parent's date is fine", async () => {
    const result = await ops.createProject({
      name: "On Time Sub",
      parentId: "p-wing-spar",
      primaryReId: "m-tyler",
      targetDate: "2026-10-30",
      createdBy: "m-anish",
      today: TODAY,
    });
    assert.equal(result.ok, true);
  });

  test("no date, or no parent date, is unconstrained", async () => {
    assert.equal(
      (
        await ops.createProject({
          name: "Undated Sub",
          parentId: "p-wing-spar",
          primaryReId: "m-tyler",
          createdBy: "m-anish",
          today: TODAY,
        })
      ).ok,
      true
    );
    // An undated parent promises nothing, so there's nothing to be late for.
    const undated = await ops.createProject({
      name: "Open Ended",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      createdBy: "m-anish",
      today: TODAY,
    });
    assert.equal(undated.ok, true);
    if (!undated.ok) return;
    assert.equal(undated.value.targetDate, undefined);

    assert.equal(
      (
        await ops.createProject({
          name: "Far Future Sub",
          parentId: undated.value.id,
          primaryReId: "m-anish",
          targetDate: "2030-01-01",
          createdBy: "m-anish",
          today: TODAY,
        })
      ).ok,
      true
    );
  });
});

describe("a new project records when it started", () => {
  /*
    Nothing draws a span yet — the mini Gantt is the next phase. This is
    recorded now because backfilling a start date later is guesswork, and the
    field was silently never set: every project created through the app had no
    left edge for a bar.
  */
  test("start date defaults to today", async () => {
    const result = await ops.createProject({
      name: "Dated On Creation",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      createdBy: "m-anish",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.startDate, TODAY);
  });

  test("an explicit target counts as overridden, so a roll-up won't erase it", async () => {
    // `datesOverridden = false` means "derive these dates from the children".
    // A date somebody typed must not be treated as derived.
    const withDate = await ops.createProject({
      name: "Has A Deadline",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      targetDate: "2026-12-01",
      createdBy: "m-anish",
      today: TODAY,
    });
    assert.equal(withDate.ok, true);
    if (withDate.ok) assert.equal(withDate.value.datesOverridden, true);

    const without = await ops.createProject({
      name: "Open Ended Too",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      createdBy: "m-anish",
      today: TODAY,
    });
    assert.equal(without.ok, true);
    if (without.ok) assert.equal(without.value.datesOverridden, false);
  });

  test("start never lands after target, which the DB also refuses", async () => {
    // 0001_core_schema.sql has
    //   check (target_date is null or start_date is null or target_date >= start_date)
    // so a project that violated it would load fine locally and fail on insert.
    const result = await ops.createProject({
      name: "Backwards",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      targetDate: "2026-01-01", // before TODAY
      createdBy: "m-anish",
      today: TODAY,
    });

    if (result.ok) {
      assert.ok(
        !result.value.startDate ||
          !result.value.targetDate ||
          result.value.startDate <= result.value.targetDate,
        "start date must not be after the target"
      );
    }
  });
});

describe("a deliverable can't be due after its project", () => {
  // p-wing-spar is due 2026-10-30 in the seed.
  test("creating one past the target is refused", async () => {
    const result = await ops.createDeliverable({
      projectId: "p-wing-spar",
      title: "Late report",
      ownerId: "m-tyler",
      dueDate: "2026-12-01",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /2026-10-30/);
      assert.match(result.error, /Wing Spar/i);
    }
  });

  test("on the target date exactly is fine", async () => {
    const result = await ops.createDeliverable({
      projectId: "p-wing-spar",
      title: "Right on time",
      ownerId: "m-tyler",
      dueDate: "2026-10-30",
    });
    assert.equal(result.ok, true);
  });

  test("no due date is unconstrained", async () => {
    const result = await ops.createDeliverable({
      projectId: "p-wing-spar",
      title: "Whenever",
      ownerId: "m-tyler",
    });
    assert.equal(result.ok, true);
  });

  test("a project with no target constrains nothing", async () => {
    const parent = await ops.createProject({
      name: "Open Ended Parent",
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      createdBy: "m-anish",
      today: TODAY,
    });
    assert.equal(parent.ok, true);
    if (!parent.ok) return;

    const result = await ops.createDeliverable({
      projectId: parent.value.id,
      title: "Far future",
      ownerId: "m-anish",
      dueDate: "2030-01-01",
    });
    assert.equal(result.ok, true);
  });

  test("moving an existing one past the target is refused", async () => {
    const existing = disk
      .readStore()
      .deliverables.find((d) => d.projectId === "p-wing-spar")!;

    const result = await ops.updateDeliverable({
      deliverableId: existing.id,
      title: existing.title,
      dueDate: "2026-12-01",
      today: TODAY,
    });

    assert.equal(result.ok, false);
    assert.equal(
      disk.readStore().deliverables.find((d) => d.id === existing.id)?.dueDate,
      existing.dueDate
    );
  });

  test("renaming still saves when the dates already clash", async () => {
    /*
      The regression guard. Every save resends the existing date, so a
      pre-existing violation would otherwise freeze the row — a rename failing
      on a date the person never touched and cannot see.
    */
    const existing = disk
      .readStore()
      .deliverables.find((d) => d.projectId === "p-wing-spar")!;
    // Reach past the operation to create the illegal state, as old data would.
    disk.readStore().deliverables.find((d) => d.id === existing.id)!.dueDate =
      "2026-12-25";

    const result = await ops.updateDeliverable({
      deliverableId: existing.id,
      title: "Renamed anyway",
      dueDate: "2026-12-25",
      today: TODAY,
    });
    assert.equal(result.ok, true);
  });

  /**
   * A project with no sub-projects, so the sub-project rule can't fire first
   * and mask what these are testing.
   */
  async function projectWithDeliverable(due: string, target = "2026-11-30") {
    const created = await ops.createProject({
      name: `Standalone ${due}`,
      parentId: null,
      teamId: "div-evtol",
      primaryReId: "m-anish",
      targetDate: target,
      createdBy: "m-anish",
      today: TODAY,
    });
    if (!created.ok) throw new Error(created.error);

    const d = await ops.createDeliverable({
      projectId: created.value.id,
      title: "The work",
      ownerId: "m-anish",
      dueDate: due,
    });
    if (!d.ok) throw new Error(d.error);
    return { project: created.value, deliverable: d.value };
  }

  test("pulling the project's target in over open work is refused", async () => {
    // The other direction. Without this, moving a target left would leave
    // deliverables dated past it — the state creation refuses.
    const { project } = await projectWithDeliverable("2026-11-20");
    const result = await setTarget(project.id, "2026-10-01");

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /deliverable/i);
      assert.match(result.error, /The work/);
    }
  });

  test("…but work already signed off doesn't block it", async () => {
    /*
      Done work is history. Refusing a date change because something finished
      after the new target would make a project whose schedule slipped
      permanently uneditable — and the deliverable is finished, so there is
      nothing left to bring in.
    */
    const { project, deliverable } = await projectWithDeliverable("2026-11-20");
    await ops.confirmDeliverable(deliverable.id, "m-anish", TODAY);

    const result = await setTarget(project.id, "2026-10-01");
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// What replaced the standing "No deputy PL" flag
// ---------------------------------------------------------------------------

describe("the last PL can't be stripped off a project with sub-projects", () => {
  /*
    The flag that used to warn about this fired on every parent project with
    one PL — permanent, and usually unfixable because there was no second
    person to name. A guard at the moment of removal is the same protection at
    the one moment somebody can act on it.
  */

  test("un-PL-ing the last one is already blocked, by the primary guard", async () => {
    /*
      Worth pinning as the reason the sub-project guard is defensive here
      rather than the thing doing the work. The last PL is by definition the
      primary, and `setProjectRE` refuses to strip the primary first — so on
      this path you always hit that message. The sub-project guard behind it
      only fires if `primaryReId` has drifted out of `reIds`, which is a data
      fault rather than a normal action.
    */
    const result = await ops.setProjectRE({
      projectId: "p-wing-spar",
      memberId: "m-tyler",
      isRE: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /primary/i);
  });

  test("a non-last PL can be removed freely", async () => {
    await ops.setProjectRE({
      projectId: "p-wing-spar",
      memberId: "m-noah",
      isRE: true,
    });
    const result = await ops.setProjectRE({
      projectId: "p-wing-spar",
      memberId: "m-noah",
      isRE: false,
    });
    assert.equal(result.ok, true);
  });

  test("leaving the project entirely is refused the same way", async () => {
    // Otherwise the rule is bypassable by removing the person, not the role.
    const result = await ops.removeProjectMember({
      projectId: "p-wing-spar",
      memberId: "m-tyler",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /sub-project/i);
  });

  test("a project with no sub-projects is unaffected", async () => {
    // p-propulsion-test is a leaf. Nothing escalates through it.
    const result = await ops.removeProjectMember({
      projectId: "p-propulsion-test",
      memberId: "m-hana",
    });
    assert.equal(result.ok, true);
  });
});
