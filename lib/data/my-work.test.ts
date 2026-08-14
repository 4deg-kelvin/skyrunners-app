/**
 * What the check-in composer offers you a box for.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * Two bugs in two days, both in the same six lines, both invisible to every
 * other check in the repo — the page rendered, nothing threw, the form
 * submitted. Only a person looking at their own projects could tell.
 *
 *   1. Sections were built from `currentUpdate.entries`, which are seeded from
 *      logged hours. Somebody on three projects who hadn't logged anything saw
 *      "nothing to fill in" and could write nothing at all — so the member with
 *      most to report, the one who was blocked, was the one told to say nothing.
 *
 *   2. Then sections were built from committed projects, and COMPLETED ones
 *      came with them. Four delivered projects meant four empty boxes asking
 *      what moved forward on work that isn't moving.
 *
 * The rule that has to hold, in one line: **a box appears for work that is
 * yours and still running, and for nothing else — except words you already
 * wrote.**
 *
 * `SKYRUNNERS_STORE_DIR` is set BEFORE the store module loads, because
 * `disk.ts` resolves its path at module scope: a static top-level import would
 * bind the developer's real `.data/` directory and this suite would rewrite it.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-mywork-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let disk: typeof import("../store/disk.ts");
let ops: typeof import("../store/operations.ts");
let getMyWork: typeof import("./my-work.ts").getMyWork;

/** Noah is committed to three projects in the seed — enough to see one drop. */
const NOAH = "m-noah";
const TODAY = "2026-08-10";

before(async () => {
  disk = await import("../store/disk.ts");
  ops = await import("../store/operations.ts");
  ({ getMyWork } = await import("./my-work.ts"));
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

/** Set a project's phase, leaving everything else as it was. */
async function setPhase(projectId: string, phase: "complete" | "testing") {
  const p = disk.readStore().projects.find((x) => x.id === projectId)!;
  const result = await ops.updateProject({
    projectId,
    name: p.name,
    description: p.description,
    phase,
    health: p.health,
    targetDate: p.targetDate,
    openRoles: p.openRoles,
    actorId: "m-anish",
    today: TODAY,
  });
  if (!result.ok) throw new Error(`setPhase failed: ${result.error}`);
}

async function sectionProjectIds(memberId: string) {
  const view = await getMyWork(memberId);
  return view.currentUpdate.sections.map((s) => s.project.id).sort();
}

describe("the check-in composer offers a box per live committed project", () => {
  test("every committed project gets one, with no hours logged", async () => {
    // Bug 1. Being on the project creates the section; hours only fill it in.
    const ids = await sectionProjectIds(NOAH);
    assert.deepEqual(ids, ["p-layup", "p-load-test", "p-wing-spar"]);
  });

  test("a completed project drops out", async () => {
    // p-load-test has no children, so it completes freely.
    await setPhase("p-load-test", "complete");

    const ids = await sectionProjectIds(NOAH);
    assert.deepEqual(ids, ["p-layup", "p-wing-spar"]);
  });

  test("reopening it brings the box straight back", async () => {
    // The behaviour that has to hold: withdrawing a sign-off puts a project
    // back to active, and the member owes an update on it again.
    await setPhase("p-load-test", "complete");
    await setPhase("p-load-test", "testing");

    const ids = await sectionProjectIds(NOAH);
    assert.deepEqual(ids, ["p-layup", "p-load-test", "p-wing-spar"]);
  });

  test("logged work on a completed project doesn't resurrect the box", async () => {
    /*
      The specific way the fix could be undone. A row seeded from logged work
      would fall through to the "projects they've since left" loop and render
      anyway, putting the empty box straight back.
    */
    const logged = await ops.logWork({
      memberId: NOAH,
      projectId: "p-load-test",
      workDate: TODAY,
      description: "packed up the rig",
      today: TODAY,
    });
    assert.equal(logged.ok, true);
    await setPhase("p-load-test", "complete");

    const ids = await sectionProjectIds(NOAH);
    assert.ok(!ids.includes("p-load-test"));
  });

  test("but words already written are never discarded", async () => {
    /*
      The other half. If they wrote a sentence and the project completed
      before they submitted, dropping the section throws away their writing —
      usually the handover note, which is the part anybody needs.
    */
    const view = await getMyWork(NOAH);
    const update = disk
      .readStore()
      .progressUpdates.find((u) => u.id === view.currentUpdate.update.id);
    assert.ok(update, "the current update should be a real row by now");

    update.entries.push({
      id: "e-test-1",
      updateId: update.id,
      projectId: "p-load-test",
      progress: "Rig is packed up, results are in the shared drive.",
    });
    await setPhase("p-load-test", "complete");

    const after = await getMyWork(NOAH);
    const kept = after.currentUpdate.sections.find(
      (s) => s.project.id === "p-load-test"
    );
    assert.ok(kept, "a section with real content must survive completion");
    assert.match(kept.entry.progress, /shared drive/);
  });

  test("following a project never creates a box", async () => {
    // Following is watch-only and carries no obligation. Same rule as before
    // the change; asserted here so the committed filter can't widen by accident.
    const view = await getMyWork(NOAH);
    const followedIds = view.following.map((f) => f.project.id);
    for (const id of followedIds) {
      assert.ok(
        !view.currentUpdate.sections.some((s) => s.project.id === id),
        `following ${id} should not produce a check-in section`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The work log, day by day, beside the form
// ---------------------------------------------------------------------------

describe("the day-by-day work log", () => {
  test("entries are grouped by day, each carrying its project", async () => {
    /*
      The grouping is the point. A flat run of "Wing Spar · Aug 5" rows is a
      timesheet however it's styled; with the day as a heading a week reads as a
      narrative, which is what the member is actually trying to remember.
    */
    const view = await getMyWork(NOAH);
    for (const day of view.recentWork.days) {
      assert.match(day.day, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(day.entries.length > 0, "an empty day must not be emitted");
      for (const row of day.entries) {
        assert.ok(
          "project" in row,
          "project must be joined, not looked up later"
        );
        assert.ok("locked" in row);
        // Every entry in a day must actually be from that day.
        assert.equal(row.log.workDate.slice(0, 10), day.day);
      }
    }
  });

  test("days come newest first", async () => {
    const view = await getMyWork(NOAH);
    const days = view.recentWork.days.map((d) => d.day);
    assert.deepEqual(days, [...days].sort().reverse());
  });

  test("two entries on the same day share one heading", async () => {
    // Otherwise the "diary" reads as two identical dated blocks, which is the
    // duplication the grouping exists to remove.
    for (const description of [
      "morning: bonded the doubler",
      "afternoon: trimmed it back",
    ]) {
      const r = await ops.logWork({
        memberId: NOAH,
        projectId: "p-layup",
        workDate: TODAY,
        description,
        today: TODAY,
      });
      assert.equal(r.ok, true);
    }

    const view = await getMyWork(NOAH);
    const today = view.recentWork.days.filter((d) => d.day === TODAY);
    assert.equal(today.length, 1, "one heading per day, not one per entry");
    assert.ok(today[0].entries.length >= 2);
  });

  test("falls back to older entries when the fortnight is empty", async () => {
    /*
      The returning-member case. Before this, somebody back from midterms saw
      an empty list — at exactly the moment "which project was I on, and what
      had I done" is the question they have. An empty space there reads as
      "you have never done anything here".
    */
    const store = disk.readStore();
    const mine = store.workLogs.filter((w) => w.memberId === NOAH);
    if (mine.length === 0) return; // fixture has none to age

    // Push every entry well outside the 14-day window.
    await disk.mutate((s) => {
      for (const w of s.workLogs) {
        if (w.memberId === NOAH) w.workDate = "2026-01-05";
      }
      return { ok: true as const, value: null };
    });

    const view = await getMyWork(NOAH);
    assert.ok(
      view.recentWork.days.length > 0,
      "an old logger must still see where they left off"
    );
    assert.equal(
      view.recentWork.stale,
      true,
      "the fallback must be marked stale so the form retitles the section"
    );
  });

  test("somebody who has never logged still sees nothing", async () => {
    // The fallback must not invent rows. `hasEverLoggedWork` is the signal
    // for this person, and it needs a different prompt entirely.
    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.memberId !== NOAH);
      return { ok: true as const, value: null };
    });

    const view = await getMyWork(NOAH);
    assert.equal(view.recentWork.days.length, 0);
    assert.equal(view.hasEverLoggedWork, false);
  });
});

// ---------------------------------------------------------------------------
// The check-in drafts itself from the log
// ---------------------------------------------------------------------------

describe("check-in sections pre-fill from the work log", () => {
  /*
    Log entries must be dated on or before mock `today()`, NOT this file's TODAY.

    `getMyWork` reads `today()` from lib/mock-data, which is `DEMO_TODAY`
    (2026-08-06) outside live mode — while `TODAY` here is 2026-08-10 and is only
    what we hand to the write operations. An entry dated 2026-08-10 is therefore
    in the FUTURE as far as the composer is concerned, `workInPeriod` filters it
    out, and the draft comes back empty. That cost a debugging round: the write
    succeeds, the read silently ignores it, and nothing anywhere says why.
  */
  const LOG_DAY = "2026-08-06";

  test("a project with logged work arrives written, and isn't demanded", async () => {
    const r = await ops.logWork({
      memberId: NOAH,
      projectId: "p-layup",
      workDate: LOG_DAY,
      description: "vacuum-bagged the second coupon",
      today: TODAY,
    });
    assert.equal(r.ok, true);

    const view = await getMyWork(NOAH);
    const section = view.currentUpdate.sections.find(
      (s) => s.project.id === "p-layup"
    );
    assert.ok(section, "p-layup should have a section");
    assert.match(section.draftProgress, /vacuum-bagged the second coupon/);
    assert.equal(section.needsWriting, false);
    assert.ok(section.loggedWork.length > 0);
  });

  test("a project with nothing logged is empty and required", async () => {
    // The one thing the member has to write, and the whole reason the rest is
    // free. `submitCheckIn` refuses on this same condition.
    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.memberId !== NOAH);
      return { ok: true as const, value: null };
    });

    const view = await getMyWork(NOAH);
    assert.ok(view.currentUpdate.sections.length > 0);
    for (const section of view.currentUpdate.sections) {
      assert.equal(section.draftProgress, "");
      assert.equal(section.needsWriting, true);
      assert.equal(section.loggedWork.length, 0);
    }
  });

  test("misc work drafts nothing — it belongs to no project", async () => {
    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.memberId !== NOAH);
      return { ok: true as const, value: null };
    });

    const r = await ops.logWork({
      memberId: NOAH,
      workDate: LOG_DAY,
      description: "helped at the open build session",
      today: TODAY,
    });
    assert.equal(r.ok, true);

    const view = await getMyWork(NOAH);
    for (const section of view.currentUpdate.sections) {
      assert.equal(
        section.needsWriting,
        true,
        "misc work must not excuse a member from reporting on their projects"
      );
    }
  });

  test("words already written beat the generated draft", async () => {
    /*
      The least forgivable thing this feature could do is overwrite somebody's
      own sentence with a machine-generated summary. If they half-wrote a
      check-in and came back, what they typed wins.
    */
    await ops.logWork({
      memberId: NOAH,
      projectId: "p-layup",
      workDate: LOG_DAY,
      description: "raw note nobody should read",
      today: TODAY,
    });

    const first = await getMyWork(NOAH);
    const update = disk
      .readStore()
      .progressUpdates.find((u) => u.id === first.currentUpdate.update.id);
    assert.ok(update);

    update.entries.push({
      id: "e-draft-guard",
      updateId: update.id,
      projectId: "p-layup",
      progress: "What I actually want my Lead to read.",
    });

    const after = await getMyWork(NOAH);
    const section = after.currentUpdate.sections.find(
      (s) => s.project.id === "p-layup"
    );
    assert.ok(section);
    assert.match(section.draftProgress, /actually want my Lead to read/);
    assert.ok(!section.draftProgress.includes("raw note"));
  });
});
