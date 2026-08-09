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

// ---------------------------------------------------------------------------
// Check-in days
// ---------------------------------------------------------------------------

describe("check-in days can be any day of the week", () => {
  const MEMBER = "m-tyler";

  /** The seed gives everyone two per week, so pairs are what's accepted. */
  async function pick(...weekdays: number[]) {
    return ops.setUpdateSchedule({ memberId: MEMBER, weekdays });
  }

  function saved() {
    return disk.readStore().updateSchedules.find((s) => s.memberId === MEMBER)
      ?.weekdays;
  }

  test("Saturday and Sunday are accepted", async () => {
    // The reason this changed: a student whose week is full of classes and who
    // builds on Sunday afternoon was being told to report on a day they hadn't
    // worked. The deadline follows the work.
    assert.equal((await pick(6, 0)).ok, true);
    assert.deepEqual(saved(), [0, 6]);
  });

  test("a weekday paired with a weekend day works", async () => {
    assert.equal((await pick(3, 6)).ok, true);
    assert.deepEqual(saved(), [3, 6]);
  });

  test("plain weekdays still work", async () => {
    assert.equal((await pick(1, 4)).ok, true);
    assert.deepEqual(saved(), [1, 4]);
  });

  test("every day 0–6 is valid", async () => {
    for (let day = 0; day <= 6; day++) {
      const other = (day + 3) % 7;
      const result = await pick(day, other);
      assert.equal(result.ok, true, `day ${day}`);
    }
  });

  test("7 and -1 are still refused", async () => {
    // 0–6, not 1–7. An off-by-one here would silently store a day that no
    // calendar has and no obligation would ever generate for.
    assert.equal((await pick(1, 7)).ok, false);
    assert.equal((await pick(-1, 3)).ok, false);
  });

  test("a fraction is refused", async () => {
    assert.equal((await pick(1, 2.5)).ok, false);
  });

  test("duplicates collapse rather than counting twice", async () => {
    // Picking Monday twice is one day, not two, and must not pass the
    // "exactly N days" check by accident.
    assert.equal((await pick(1, 1)).ok, false);
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
