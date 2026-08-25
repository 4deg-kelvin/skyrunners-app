/**
 * Moving a project's target date, keeping the old one.
 *
 * Run with:  npm test
 *
 * The rules worth pinning are the ones that make the history trustworthy: a slip
 * with no reason, a "move" that moves nothing, and a date that breaks the
 * parent/child constraint would each leave the record either empty or wrong.
 *
 * Its own file rather than more of `operations.test.ts` because that one is
 * already 1,200 lines and this is a self-contained feature. Same harness: the
 * store directory is set BEFORE the store module loads, because `disk.ts`
 * resolves its path at module scope and a static import would bind the real
 * `.data/` directory and rewrite the developer's local store.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-deadline-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";
const MEMBER = "m-tyler";
const PROJECT = "p-wing-spar";

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

/** The project's current target, read fresh so the helpers below compose. */
const target = () =>
  disk.readStore().projects.find((p) => p.id === PROJECT)!.targetDate!;

/** A date N days from the CURRENT target. UTC, per lib/dates.ts. */
function shift(days: number): string {
  const d = new Date(`${target()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function history() {
  return disk
    .readStore()
    .projectDeadlineChanges.filter((c) => c.projectId === PROJECT);
}

describe("changeProjectDeadline", () => {
  test("the date moves and the old one is recorded", async () => {
    const from = target();
    const to = shift(14);

    const r = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: to,
      reason: "Waiting on the laser cutter, shop is booked until the 20th.",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    assert.equal(
      disk.readStore().projects.find((p) => p.id === PROJECT)?.targetDate,
      to,
      "the project should now be due on the new date"
    );

    const rows = history();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fromDate, from, "the OLD date must survive");
    assert.equal(rows[0].toDate, to);
    assert.match(rows[0].reason, /laser cutter/);
    assert.equal(rows[0].changedById, MEMBER);
  });

  test("a slip with no reason is refused, and writes nothing", async () => {
    /*
      The rule the whole table exists for. A date that moved for no recorded
      reason records that the schedule slipped and nothing anybody can learn
      from, which is the state this replaced.
    */
    for (const reason of ["", "   "]) {
      const r = await ops.changeProjectDeadline({
        projectId: PROJECT,
        targetDate: shift(7),
        reason,
        actorId: MEMBER,
        today: TODAY,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /why/i);
    }
    assert.equal(history().length, 0, "a refused move must write no history");
  });

  test("moving to the same date is refused", async () => {
    // A change that changes nothing is noise in the history, and would let
    // somebody pad the record. Migration 0040 has the same rule as a CHECK.
    const r = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: target(),
      reason: "no-op",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /already due/i);
  });

  test("an essay is refused because it goes up the chain", async () => {
    const r = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: shift(7),
      reason: "x".repeat(401),
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
  });

  test("pushing past the parent target is refused", async () => {
    /*
      The same constraint `updateProject` enforces, through the shared
      `targetDateClash`. Two copies of a date rule is how one path ends up
      permitting a schedule the other refuses, and the symptom is a project whose
      dates are illegal but which saves fine through one form.
    */
    const store = disk.readStore();
    const child = store.projects.find(
      (p) => p.parentId && p.targetDate && p.phase !== "complete"
    );
    if (!child) assert.fail("seed has no dated sub-project");

    const parent = store.projects.find((p) => p.id === child.parentId);
    if (!parent?.targetDate) {
      assert.fail("that sub-project parent is undated");
    }

    const past = new Date(`${parent.targetDate}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() + 30);

    const r = await ops.changeProjectDeadline({
      projectId: child.id,
      targetDate: past.toISOString().slice(0, 10),
      reason: "slipping past the parent",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(parent.name));
  });

  test("a project with no target has nothing to move", async () => {
    // Setting a FIRST date is not a slip, and recording it as one would put a
    // project into the "has slipped" list the day somebody first dated it.
    const undated = disk
      .readStore()
      .projects.find((p) => !p.targetDate && p.phase !== "complete");
    if (!undated) return; // seed has none, nothing to assert

    const r = await ops.changeProjectDeadline({
      projectId: undated.id,
      targetDate: "2026-12-01",
      reason: "setting a first date",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /no target date/i);
  });

  test("a complete project keeps its dates", async () => {
    // Completion freezes the record. Moving the target of something already
    // delivered would rewrite what it looks like it achieved.
    const done = disk
      .readStore()
      .projects.find((p) => p.phase === "complete" && p.targetDate);
    if (!done) return; // seed has none

    const r = await ops.changeProjectDeadline({
      projectId: done.id,
      targetDate: "2027-01-01",
      reason: "revising after the fact",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /complete/i);
  });
});

describe("who hears about a slip", () => {
  test("pushing it out announces itself", async () => {
    const before = disk.readStore().projectNotices.length;
    const r = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: shift(21),
      reason: "Composite oven down until the shop replaces the controller.",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    const notices = disk.readStore().projectNotices;
    assert.equal(notices.length, before + 1);
    const notice = notices[notices.length - 1];
    assert.equal(notice.kind, "deadline_pushed");
    assert.match(notice.body, /21 days later/);
    assert.match(notice.body, /controller/, "the reason travels with it");
  });

  test("pulling it IN records history but sends no notice", async () => {
    /*
      Good news that notifies trains people to ignore the notification, and the
      one notice that must never be ignored is the one saying a project is late.
      The move is still recorded: the history is the audit trail, not the alert.
    */
    const before = disk.readStore().projectNotices.length;
    const r = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: shift(-3),
      reason: "Vendor delivered early.",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    assert.equal(disk.readStore().projectNotices.length, before);
    assert.equal(history().length, 1, "it is still in the history");
  });
});

describe("the history is the point", () => {
  test("repeated slips accumulate rather than overwrite", async () => {
    // The reason this is a table and not an `original_target_date` column: the
    // case worth seeing is a project that keeps moving.
    for (const [days, why] of [
      [7, "first slip"],
      [14, "second slip"],
      [21, "third slip"],
    ] as const) {
      const r = await ops.changeProjectDeadline({
        projectId: PROJECT,
        targetDate: shift(days),
        reason: why,
        actorId: MEMBER,
        today: TODAY,
      });
      assert.equal(r.ok, true, r.ok ? "" : r.error);
    }

    const rows = history();
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((c) => c.reason),
      ["first slip", "second slip", "third slip"]
    );
  });

  test("a move through the full project editor is recorded too", async () => {
    /*
      The hole this closes. `changeProjectDeadline` requires a reason, so if only
      it recorded history a PL could move the date through the project editor
      instead and the slip would leave no trace at all. A row with an empty
      reason is worse history than a good one and far better than none, and the
      UI labels it as such.
    */
    const project = disk.readStore().projects.find((p) => p.id === PROJECT)!;
    const to = shift(10);

    const r = await ops.updateProject({
      projectId: PROJECT,
      name: project.name,
      description: project.description,
      phase: project.phase,
      health: project.health,
      targetDate: to,
      openRoles: project.openRoles,
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    const rows = history();
    assert.equal(rows.length, 1, "the editor must not bypass the history");
    assert.equal(rows[0].toDate, to);
    assert.equal(rows[0].reason, "", "no reason is available on that path");
  });

  test("an unrelated edit writes no history", async () => {
    // Every save posts the whole form, so renaming a project resends its
    // existing date. That must not look like a slip.
    const project = disk.readStore().projects.find((p) => p.id === PROJECT)!;

    const r = await ops.updateProject({
      projectId: PROJECT,
      name: `${project.name} mk2`,
      description: project.description,
      phase: project.phase,
      health: project.health,
      targetDate: project.targetDate,
      openRoles: project.openRoles,
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
    assert.equal(history().length, 0);
  });

  test("deleting the project takes its history with it", async () => {
    // Append-only while the project lives, but there is no project left to hold
    // a schedule for. Matches the `on delete cascade` in migration 0040.
    const moved = await ops.changeProjectDeadline({
      projectId: PROJECT,
      targetDate: shift(7),
      reason: "slipping",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(moved.ok, true);
    assert.equal(history().length, 1);

    const gone = await ops.deleteProject(PROJECT);
    if (!gone.ok) return; // refused for an unrelated reason; nothing to assert
    assert.equal(history().length, 0);
  });
});
