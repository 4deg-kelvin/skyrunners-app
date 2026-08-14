/**
 * Pushing back a deliverable's deadline, and the nesting rules that bound it.
 *
 * Run with:  npm test
 *
 * The rules worth pinning are the containment ones: work inside a project cannot
 * land after the project, and a sub-project cannot land after its parent. Both are
 * checked in BOTH directions elsewhere; these tests cover them from the
 * push-back path specifically, because that path is new and shares its helpers
 * with the older one — which is exactly the arrangement where one caller quietly
 * stops enforcing something.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-deliv-deadline-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";
const MEMBER = "m-tyler";

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
    // Best effort.
  }
});

/** A dated, unfinished deliverable whose project has a target. */
function subject() {
  const store = disk.readStore();
  for (const d of store.deliverables) {
    if (!d.dueDate || d.status === "done") continue;
    const project = store.projects.find((p) => p.id === d.projectId);
    if (project?.targetDate && project.phase !== "complete") {
      return { deliverable: d, project };
    }
  }
  assert.fail("seed has no dated deliverable under a dated live project");
}

function historyFor(deliverableId: string) {
  return disk
    .readStore()
    .projectDeadlineChanges.filter((c) => c.deliverableId === deliverableId);
}

describe("changeDeliverableDeadline", () => {
  test("the date moves and the old one is recorded against the project", async () => {
    const { deliverable, project } = subject();
    const from = deliverable.dueDate!.slice(0, 10);
    // Somewhere between the old date and the project's target.
    const to = project.targetDate!.slice(0, 10);

    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: to,
      reason: "Waiting on 6061 stock — the shop reorders Monday.",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    const after = disk
      .readStore()
      .deliverables.find((d) => d.id === deliverable.id);
    assert.equal(after?.dueDate, to);

    const rows = historyFor(deliverable.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].fromDate, from, "the OLD date must survive");
    assert.equal(rows[0].toDate, to);
    assert.equal(
      rows[0].projectId,
      project.id,
      "it must hang off the project, so one query gives the whole history"
    );
    assert.match(rows[0].reason, /6061/);
  });

  test("no reason, no move", async () => {
    const { deliverable, project } = subject();
    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: project.targetDate!.slice(0, 10),
      reason: "   ",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /why/i);
    assert.equal(historyFor(deliverable.id).length, 0);
  });

  test("moving to the same date is refused", async () => {
    const { deliverable } = subject();
    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: deliverable.dueDate!.slice(0, 10),
      reason: "no-op",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /already due/i);
  });
});

/**
 * The containment rules. This is the half Anish asked about explicitly: a
 * deliverable is bounded by its project, and a sub-project by its parent.
 */
describe("nothing can be pushed past what contains it", () => {
  test("a deliverable cannot land after its project", async () => {
    const { deliverable, project } = subject();

    const past = new Date(`${project.targetDate!.slice(0, 10)}T00:00:00Z`);
    past.setUTCDate(past.getUTCDate() + 14);

    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: past.toISOString().slice(0, 10),
      reason: "slipping past the project",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      // The message names the project and its date, so the fix is obvious:
      // push the project back first.
      assert.match(r.error, new RegExp(project.name));
      assert.match(r.error, /can't be due/);
    }
    assert.equal(historyFor(deliverable.id).length, 0);
  });

  test("landing exactly ON the project's target is allowed", async () => {
    // The boundary. `dueAfterProject` refuses `>`, not `>=` — work finishing the
    // same day the project does is normal, and refusing it would be off by one.
    const { deliverable, project } = subject();
    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: project.targetDate!.slice(0, 10),
      reason: "finishing the same day the project lands",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);
  });

  test("a sub-project cannot be pushed past its parent", async () => {
    /*
      The project-level twin, through the shared `targetDateClash`. Both paths
      have to enforce it or one form quietly permits a schedule the other
      refuses — and the illegal state then exists with nothing to explain it.
    */
    const store = disk.readStore();
    const child = store.projects.find(
      (p) => p.parentId && p.targetDate && p.phase !== "complete"
    );
    if (!child) assert.fail("seed has no dated sub-project");
    const parent = store.projects.find((p) => p.id === child.parentId);
    if (!parent?.targetDate) assert.fail("that parent is undated");

    const past = new Date(`${parent.targetDate.slice(0, 10)}T00:00:00Z`);
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

  test("pulling a parent IN over a later child is refused too", async () => {
    // The same rule from the other direction, which is the one people forget.
    const store = disk.readStore();
    const child = store.projects.find(
      (p) => p.parentId && p.targetDate && p.phase !== "complete"
    );
    if (!child) return;
    const parent = store.projects.find((p) => p.id === child.parentId);
    if (!parent?.targetDate) return;

    const before = new Date(`${child.targetDate!.slice(0, 10)}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);

    const r = await ops.changeProjectDeadline({
      projectId: parent.id,
      targetDate: before.toISOString().slice(0, 10),
      reason: "pulling the parent in over its child",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, new RegExp(child.name));
  });
});

describe("the project's Gantt baseline ignores deliverable moves", () => {
  test("pushing a deliverable does not fake a project slip", async () => {
    /*
      The bug this exists to prevent, caught while wiring 0042: both kinds of row
      live in one table, so a baseline that did not filter on `deliverableId`
      would draw a ghost marker for a date the PROJECT was never due on. A chart
      that is confidently wrong is worse than one that shows nothing.
    */
    const mock = await import("../mock-data.ts");
    const { deliverable, project } = subject();

    assert.equal(
      mock.baselineTargetDate(project.id),
      undefined,
      "nothing has moved yet"
    );

    const r = await ops.changeDeliverableDeadline({
      deliverableId: deliverable.id,
      dueDate: project.targetDate!.slice(0, 10),
      reason: "moving the work, not the project",
      actorId: MEMBER,
      today: TODAY,
    });
    assert.equal(r.ok, true, r.ok ? "" : r.error);

    assert.equal(
      mock.baselineTargetDate(project.id),
      undefined,
      "a deliverable move must not become the project's baseline"
    );
  });
});
