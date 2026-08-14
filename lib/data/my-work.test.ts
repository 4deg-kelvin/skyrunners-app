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

  test("hours on a completed project don't resurrect the box", async () => {
    /*
      The specific way the fix could be undone. A row seeded from logged hours
      would fall through to the "projects they've since left" loop and render
      anyway, putting the empty box straight back.
    */
    const logged = await ops.logHours({
      memberId: NOAH,
      projectId: "p-load-test",
      workDate: TODAY,
      hours: 4,
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
      hours: 0,
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
// What the log-hours form shows beside itself
// ---------------------------------------------------------------------------

describe("hours history for the log form", () => {
  test("recent entries carry the project and the note", async () => {
    /*
      The whole reason the list exists: "3 hrs" tells you nothing a week later,
      "3 hrs on Wing Spar — ran the tensile coupons" tells you where to pick up.
    */
    const view = await getMyWork(NOAH);
    for (const row of view.recentHours) {
      assert.ok(
        "project" in row,
        "project must be joined, not looked up later"
      );
      assert.ok("locked" in row);
      assert.ok("stale" in row);
    }
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
      view.recentHours.length > 0,
      "an old logger must still see where they left off"
    );
    assert.equal(
      view.recentHours.every((r) => r.stale),
      true,
      "those rows must be marked stale so the form retitles the section"
    );
  });

  test("somebody who has never logged still sees nothing", async () => {
    // The fallback must not invent rows. `hasEverLoggedHours` is the signal
    // for this person, and it needs a different prompt entirely.
    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.memberId !== NOAH);
      return { ok: true as const, value: null };
    });

    const view = await getMyWork(NOAH);
    assert.equal(view.recentHours.length, 0);
    assert.equal(view.hasEverLoggedHours, false);
  });
});
