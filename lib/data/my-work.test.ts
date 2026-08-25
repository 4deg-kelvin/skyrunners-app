/**
 * The work log, day by day, on My Work.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * It was written for the check-in composer, which the club retired on
 * 2026-08-24. Two bugs in two days lived in the six lines that decided which
 * projects it offered a box for, and both were invisible to every other check
 * in the repo -- the page rendered, nothing threw, the form submitted:
 *
 *   1. Sections were built from `currentUpdate.entries`, which were seeded from
 *      logged hours. Somebody on three projects who hadn't logged anything saw
 *      "nothing to fill in" -- so the member with most to report, the one who
 *      was blocked, was the one told to say nothing.
 *
 *   2. Then sections were built from committed projects, and COMPLETED ones came
 *      with them. Four delivered projects meant four empty boxes asking what
 *      moved forward on work that isn't moving.
 *
 * Those tests went with the composer. The lesson did not, and it applies to
 * every list of a member's projects this app renders: **show work that is theirs
 * and still running, and nothing else.**
 *
 * What is left here is the log itself, which the removal made more important
 * rather than less -- it is now the only thing a member writes about their own
 * progress.
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
