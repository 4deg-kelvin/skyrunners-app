/**
 * Tests for the write layer.
 *
 * Run with:  npm test
 *
 * These encode the four decisions Anish made on 2026-08-07, so the reasoning
 * survives the swap to Postgres — when these bodies become SQL, the rules they
 * assert must still hold.
 *
 * Writes go to a throwaway directory via `SKYRUNNERS_STORE_DIR`, set BEFORE the
 * store module is imported. Import order matters: `disk.ts` resolves its path at
 * module scope, so a static `import` at the top of this file would bind the real
 * `.data/` directory before the env var was set, and the suite would quietly
 * rewrite the developer's local store.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-store-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

// Populated by the dynamic import in `before()`.
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
  // Each test starts from the mock seed, so ordering can't matter.
  disk.resetStore();
});

process.on("exit", () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort — a leftover temp dir is harmless.
  }
});

describe("logging hours", () => {
  test("a normal entry is stored", async () => {
    const before = disk.readStore().workLogs.length;
    const result = await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: TODAY,
      hours: 3.5,
      description: "FEA runs",
      today: TODAY,
    });

    assert.equal(result.ok, true);
    assert.equal(disk.readStore().workLogs.length, before + 1);
    if (result.ok) {
      assert.equal(result.value.hours, 3.5);
      assert.equal(result.value.description, "FEA runs");
    }
  });

  test("survives a reload — that's the whole point of the disk store", async () => {
    await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: TODAY,
      hours: 2,
      today: TODAY,
    });
    const count = disk.readStore().workLogs.length;

    // Simulate a process restart: drop the in-memory cache, re-read the file.
    disk.__resetCacheForTests();
    assert.equal(disk.readStore().workLogs.length, count);
  });

  test("zero and negative hours are refused", async () => {
    for (const hours of [0, -1]) {
      const r = await ops.logHours({
        memberId: MEMBER,
        projectId: PROJECT,
        workDate: TODAY,
        hours,
        today: TODAY,
      });
      assert.equal(r.ok, false);
    }
  });

  test("an implausible entry is refused — 80 usually means 8.0", async () => {
    const r = await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: TODAY,
      hours: 80,
      today: TODAY,
    });
    assert.equal(r.ok, false);
  });

  test("future dates are refused", async () => {
    const r = await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: "2026-08-11",
      hours: 2,
      today: TODAY,
    });
    assert.equal(r.ok, false);
  });

  describe(`backdating stops at ${7} days`, () => {
    test("exactly 7 days back is allowed", async () => {
      const r = await ops.logHours({
        memberId: MEMBER,
        projectId: PROJECT,
        workDate: "2026-08-03",
        hours: 2,
        today: TODAY,
      });
      assert.equal(r.ok, true);
    });

    test("8 days back is refused, and says how far back you can go", async () => {
      const r = await ops.logHours({
        memberId: MEMBER,
        projectId: PROJECT,
        workDate: "2026-08-02",
        hours: 2,
        today: TODAY,
      });
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.error, /7 days back/);
    });

    test("the limit matches the exported constant", () => {
      // If someone changes the constant, the messages and tests move together.
      assert.equal(ops.MAX_BACKDATE_DAYS, 7);
    });
  });
});

describe("hours lock once a check-in has reported them", () => {
  // m-sofia has a submitted update in the seed (u-1, submitted 2026-08-05).
  const SOFIA = "m-sofia";

  test("a day already covered by a submitted check-in is locked", () => {
    assert.equal(ops.hoursAreLocked(SOFIA, "2026-08-04"), true);
  });

  test("logging into a locked day is refused", async () => {
    const r = await ops.logHours({
      memberId: SOFIA,
      projectId: "p-layup",
      workDate: "2026-08-04",
      hours: 2,
      today: "2026-08-06",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /locked/i);
  });

  test("someone with no submitted check-in is never locked", () => {
    // Otherwise a brand-new member couldn't log anything at all.
    assert.equal(ops.hoursAreLocked("m-blake", "2026-08-04"), false);
  });

  test("one member's check-in doesn't lock another's hours", () => {
    assert.equal(ops.hoursAreLocked("m-tyler", "2026-07-01"), false);
  });
});

describe("deleting hours", () => {
  test("you can delete your own unlocked entry", async () => {
    const created = await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: TODAY,
      hours: 1,
      today: TODAY,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const r = await ops.deleteWorkLog(created.value.id, MEMBER, TODAY);
    assert.equal(r.ok, true);
    assert.equal(
      disk.readStore().workLogs.some((w) => w.id === created.value.id),
      false
    );
  });

  test("you cannot delete someone else's", async () => {
    const created = await ops.logHours({
      memberId: MEMBER,
      projectId: PROJECT,
      workDate: TODAY,
      hours: 1,
      today: TODAY,
    });
    if (!created.ok) return;

    const r = await ops.deleteWorkLog(created.value.id, "m-omar", TODAY);
    assert.equal(r.ok, false);
    assert.equal(
      disk.readStore().workLogs.some((w) => w.id === created.value.id),
      true
    );
  });
});

describe("creating a deliverable", () => {
  test("a blank title is refused", async () => {
    const r = await ops.createDeliverable({
      projectId: PROJECT,
      title: "   ",
      ownerId: MEMBER,
    });
    assert.equal(r.ok, false);
  });

  test("it lands at the end of the project's list", async () => {
    const existing = disk
      .readStore()
      .deliverables.filter((d) => d.projectId === PROJECT);
    const maxOrder = existing.reduce((m, d) => Math.max(m, d.sortOrder), 0);

    const r = await ops.createDeliverable({
      projectId: PROJECT,
      title: "New thing",
      ownerId: MEMBER,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.sortOrder, maxOrder + 1);
  });

  test("assigning to a non-member auto-adds them as committed", async () => {
    // m-blake is on no projects at all in the seed.
    const before = disk
      .readStore()
      .projectMemberships.filter((m) => m.memberId === "m-blake");
    assert.equal(before.length, 0);

    await ops.createDeliverable({
      projectId: PROJECT,
      title: "Something for Blake",
      ownerId: "m-blake",
    });

    const after = disk
      .readStore()
      .projectMemberships.filter((m) => m.memberId === "m-blake");
    assert.equal(after.length, 1);
    assert.equal(after[0].projectId, PROJECT);
    assert.equal(after[0].commitment, "committed");
  });

  test("being handed work promotes a follower to committed", async () => {
    // m-theo follows p-airframe-v2 without being committed to it.
    await ops.createDeliverable({
      projectId: "p-airframe-v2",
      title: "Real work now",
      ownerId: "m-theo",
    });

    const membership = disk
      .readStore()
      .projectMemberships.find(
        (m) => m.memberId === "m-theo" && m.projectId === "p-airframe-v2"
      );
    assert.equal(membership?.commitment, "committed");
  });

  test("an existing member isn't added twice", async () => {
    await ops.createDeliverable({
      projectId: PROJECT,
      title: "Another",
      ownerId: MEMBER,
    });
    const rows = disk
      .readStore()
      .projectMemberships.filter(
        (m) => m.memberId === MEMBER && m.projectId === PROJECT
      );
    assert.equal(rows.length, 1);
  });
});

describe("sign-off: the owner claims, the RE decides", () => {
  async function fresh() {
    const r = await ops.createDeliverable({
      projectId: PROJECT,
      title: "Spar analysis",
      ownerId: MEMBER,
    });
    assert.equal(r.ok, true);
    return r.ok ? r.value.id : "";
  }

  test("the owner marking it done does NOT complete it", async () => {
    const id = await fresh();
    const r = await ops.submitDeliverable(id, MEMBER, TODAY);

    assert.equal(r.ok, true);
    if (r.ok) {
      // The distinction the whole two-step exists for.
      assert.equal(r.value.status, "submitted");
      assert.notEqual(r.value.status, "done");
      assert.equal(r.value.completedAt, undefined);
    }
  });

  test("someone who isn't the owner cannot claim it", async () => {
    const id = await fresh();
    const r = await ops.submitDeliverable(id, "m-omar", TODAY);
    assert.equal(r.ok, false);
  });

  test("RE confirmation is what completes it, and records who", async () => {
    const id = await fresh();
    await ops.submitDeliverable(id, MEMBER, TODAY);
    const r = await ops.confirmDeliverable(id, "m-priya", TODAY);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.status, "done");
      assert.equal(r.value.completedAt, TODAY);
      assert.equal(r.value.confirmedById, "m-priya");
    }
  });

  test("reopening sends it back with a reason, and clears the claim", async () => {
    const id = await fresh();
    await ops.submitDeliverable(id, MEMBER, TODAY);
    const r = await ops.reopenDeliverable(id, "Load case 3 is missing", TODAY);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.status, "in_progress");
      assert.equal(r.value.submittedAt, undefined);
      assert.equal(r.value.blockerNote, "Load case 3 is missing");
    }
  });

  test("reopening without a reason is refused", async () => {
    // A bare rejection is what makes people stop submitting.
    const id = await fresh();
    await ops.submitDeliverable(id, MEMBER, TODAY);
    const r = await ops.reopenDeliverable(id, "   ", TODAY);
    assert.equal(r.ok, false);
  });

  test("signing off twice is refused", async () => {
    const id = await fresh();
    await ops.submitDeliverable(id, MEMBER, TODAY);
    await ops.confirmDeliverable(id, "m-priya", TODAY);
    const again = await ops.confirmDeliverable(id, "m-priya", TODAY);
    assert.equal(again.ok, false);
  });
});

describe("checklists under a deliverable", () => {
  async function withTodos(titles: string[]) {
    const created = await ops.createDeliverable({
      projectId: PROJECT,
      title: "Spar layup",
      ownerId: MEMBER,
    });
    if (!created.ok) throw new Error("setup failed");

    const ids: string[] = [];
    for (const title of titles) {
      const todo = await ops.addDeliverableTodo({
        deliverableId: created.value.id,
        title,
        actorId: MEMBER,
      });
      if (!todo.ok) throw new Error(`setup failed: ${todo.error}`);
      ids.push(todo.value.id);
    }
    return { deliverableId: created.value.id, todoIds: ids };
  }

  test("items append in the order they were written", async () => {
    const { deliverableId } = await withTodos(["First", "Second", "Third"]);
    const list = disk
      .readStore()
      .deliverableTodos.filter((t) => t.deliverableId === deliverableId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => t.title);
    assert.deepEqual(list, ["First", "Second", "Third"]);
  });

  test("a blank title is refused", async () => {
    const { deliverableId } = await withTodos([]);
    const r = await ops.addDeliverableTodo({
      deliverableId,
      title: "   ",
      actorId: MEMBER,
    });
    assert.equal(r.ok, false);
  });

  /*
    The rule the whole feature exists for. Both halves are asserted, because
    gating only the RE would put the wall in front of the person who didn't
    write the list.
  */
  test("the owner can't claim done while an item is open", async () => {
    const { deliverableId } = await withTodos(["Move the jig"]);
    const r = await ops.submitDeliverable(deliverableId, MEMBER, TODAY);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Move the jig/);
  });

  test("an RE can't sign off while an item is open", async () => {
    const { deliverableId } = await withTodos(["Move the jig"]);
    const r = await ops.confirmDeliverable(deliverableId, "m-priya", TODAY);
    assert.equal(r.ok, false);
  });

  test("ticking everything off unblocks sign-off", async () => {
    const { deliverableId, todoIds } = await withTodos(["A", "B"]);
    for (const todoId of todoIds) {
      await ops.setDeliverableTodoDone({
        todoId,
        done: true,
        actorId: MEMBER,
        now: TODAY,
      });
    }

    assert.equal(
      (await ops.submitDeliverable(deliverableId, MEMBER, TODAY)).ok,
      true
    );
    assert.equal(
      (await ops.confirmDeliverable(deliverableId, "m-priya", TODAY)).ok,
      true
    );
  });

  /*
    Deleting is a legitimate way to clear the gate — unlike a deliverable, a
    todo counts towards nothing, so "it turned out not to be needed" must not
    force a false tick into the record.
  */
  test("deleting the last open item unblocks sign-off too", async () => {
    const { deliverableId, todoIds } = await withTodos(["Not needed"]);
    assert.equal((await ops.deleteDeliverableTodo(todoIds[0])).ok, true);
    assert.equal(
      (await ops.submitDeliverable(deliverableId, MEMBER, TODAY)).ok,
      true
    );
  });

  test("unticking clears the timestamp, not just the flag", async () => {
    const { todoIds } = await withTodos(["A"]);
    await ops.setDeliverableTodoDone({
      todoId: todoIds[0],
      done: true,
      actorId: MEMBER,
      now: TODAY,
    });

    const ticked = disk
      .readStore()
      .deliverableTodos.find((t) => t.id === todoIds[0]);
    assert.equal(ticked?.doneAt, TODAY);
    assert.equal(ticked?.doneBy, MEMBER);

    await ops.setDeliverableTodoDone({
      todoId: todoIds[0],
      done: false,
      actorId: MEMBER,
      now: TODAY,
    });

    /*
      Postgres has a CHECK that `done` and `done_at` agree (migration 0028). A
      stale timestamp would be rejected live and pass silently in demo mode,
      which is the worst kind of divergence between the two backends.
    */
    const unticked = disk
      .readStore()
      .deliverableTodos.find((t) => t.id === todoIds[0]);
    assert.equal(unticked?.doneAt, undefined);
    assert.equal(unticked?.doneBy, undefined);
  });

  test("nothing can be added to work that's already signed off", async () => {
    const { deliverableId } = await withTodos([]);
    await ops.submitDeliverable(deliverableId, MEMBER, TODAY);
    await ops.confirmDeliverable(deliverableId, "m-priya", TODAY);

    const r = await ops.addDeliverableTodo({
      deliverableId,
      title: "Too late",
      actorId: MEMBER,
    });
    assert.equal(r.ok, false);
  });

  test("renaming keeps the tick", async () => {
    const { todoIds } = await withTodos(["Typo"]);
    await ops.setDeliverableTodoDone({
      todoId: todoIds[0],
      done: true,
      actorId: MEMBER,
      now: TODAY,
    });
    const r = await ops.renameDeliverableTodo({
      todoId: todoIds[0],
      title: "Fixed",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.title, "Fixed");
      assert.equal(r.value.done, true);
    }
  });

  test("a deleted deliverable takes its checklist with it", async () => {
    const { deliverableId, todoIds } = await withTodos(["A", "B"]);
    assert.equal((await ops.deleteDeliverable(deliverableId)).ok, true);

    // The cascade is `on delete cascade` live; demo mode must match, or the
    // store fills with orphans that no page can ever reach.
    const left = disk
      .readStore()
      .deliverableTodos.filter((t) => todoIds.includes(t.id));
    assert.equal(left.length, 0);
  });
});

describe("blocking", () => {
  test("blocked requires a reason — otherwise nobody can clear it", async () => {
    const created = await ops.createDeliverable({
      projectId: PROJECT,
      title: "Stuck thing",
      ownerId: MEMBER,
    });
    if (!created.ok) return;

    const bad = await ops.setDeliverableStatus(created.value.id, "blocked");
    assert.equal(bad.ok, false);

    const good = await ops.setDeliverableStatus(
      created.value.id,
      "blocked",
      "Waiting on the load cell"
    );
    assert.equal(good.ok, true);
    if (good.ok)
      assert.equal(good.value.blockerNote, "Waiting on the load cell");
  });

  test("moving off blocked clears the note", async () => {
    const created = await ops.createDeliverable({
      projectId: PROJECT,
      title: "Was stuck",
      ownerId: MEMBER,
    });
    if (!created.ok) return;

    await ops.setDeliverableStatus(created.value.id, "blocked", "Waiting");
    const r = await ops.setDeliverableStatus(created.value.id, "in_progress");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.blockerNote, undefined);
  });
});

describe("marking a check-in read", () => {
  // u-1 is m-sofia's submitted check-in in the seed.
  const SUBMITTED = "u-1";

  test("a submitted check-in can be marked read, and records who", async () => {
    const r = await ops.markUpdateReviewed({
      updateId: SUBMITTED,
      reviewedBy: "m-dev",
      today: TODAY,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.status, "reviewed");
      assert.equal(r.value.reviewedBy, "m-dev");
      assert.equal(r.value.reviewedAt, TODAY);
    }
  });

  test("it stops the escalation clock", async () => {
    // The whole point: an unread report escalates, a read one doesn't.
    const before = disk
      .readStore()
      .progressUpdates.filter((u) => u.status === "submitted").length;
    await ops.markUpdateReviewed({
      updateId: SUBMITTED,
      reviewedBy: "m-dev",
      today: TODAY,
    });
    const after = disk
      .readStore()
      .progressUpdates.filter((u) => u.status === "submitted").length;
    assert.equal(after, before - 1);
  });

  test("marking the same one twice is refused", async () => {
    await ops.markUpdateReviewed({
      updateId: SUBMITTED,
      reviewedBy: "m-dev",
      today: TODAY,
    });
    const again = await ops.markUpdateReviewed({
      updateId: SUBMITTED,
      reviewedBy: "m-dev",
      today: TODAY,
    });
    assert.equal(again.ok, false);
  });

  test("an unsubmitted check-in cannot be marked read", async () => {
    // u-6 is m-noah's, still pending — there is nothing to have read.
    const r = await ops.markUpdateReviewed({
      updateId: "u-6",
      reviewedBy: "m-dev",
      today: TODAY,
    });
    assert.equal(r.ok, false);
  });

  test("an unknown id fails rather than throwing", async () => {
    const r = await ops.markUpdateReviewed({
      updateId: "nope",
      reviewedBy: "m-dev",
      today: TODAY,
    });
    assert.equal(r.ok, false);
  });
});

describe("concurrent writes", () => {
  test("simultaneous logs don't lose each other", async () => {
    // Next handles requests concurrently even in dev, and a double-clicked
    // button is the everyday version of this.
    const before = disk.readStore().workLogs.length;

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ops.logHours({
          memberId: MEMBER,
          projectId: PROJECT,
          workDate: TODAY,
          hours: 1,
          description: `entry ${i}`,
          today: TODAY,
        })
      )
    );

    assert.equal(disk.readStore().workLogs.length, before + 8);
  });
});

describe("advisors named on a project", () => {
  const ADVISOR = "m-tyler";

  async function makeAdvisor(id = ADVISOR) {
    const r = await ops.setGlobalRole({ memberId: id, role: "advisor" });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }

  test("a non-advisor is refused, with a sentence that says what to do", async () => {
    const r = await ops.addProjectAdvisor({
      projectId: PROJECT,
      memberId: MEMBER,
      actorId: "m-priya",
      now: TODAY,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /isn't an advisor/);
  });

  test("an advisor can be named", async () => {
    await makeAdvisor();
    const r = await ops.addProjectAdvisor({
      projectId: PROJECT,
      memberId: ADVISOR,
      actorId: "m-priya",
      now: TODAY,
    });
    assert.equal(r.ok, true);
    assert.equal(
      disk.readStore().projectAdvisors.filter((a) => a.projectId === PROJECT)
        .length,
      1
    );
  });

  test("naming the same person twice is refused, not duplicated", async () => {
    await makeAdvisor();
    const args = {
      projectId: PROJECT,
      memberId: ADVISOR,
      actorId: "m-priya",
      now: TODAY,
    };
    assert.equal((await ops.addProjectAdvisor(args)).ok, true);
    assert.equal((await ops.addProjectAdvisor(args)).ok, false);
    assert.equal(disk.readStore().projectAdvisors.length, 1);
  });

  test("an inactive advisor is refused — the page would point at a locked account", async () => {
    await makeAdvisor();
    await ops.setMemberStatus({ memberId: ADVISOR, status: "inactive" });

    const r = await ops.addProjectAdvisor({
      projectId: PROJECT,
      memberId: ADVISOR,
      actorId: "m-priya",
      now: TODAY,
    });
    assert.equal(r.ok, false);
  });

  test("removing one takes nothing else with it", async () => {
    await makeAdvisor();
    await ops.addProjectAdvisor({
      projectId: PROJECT,
      memberId: ADVISOR,
      actorId: "m-priya",
      now: TODAY,
    });

    const deliverablesBefore = disk.readStore().deliverables.length;
    const r = await ops.removeProjectAdvisor({
      projectId: PROJECT,
      memberId: ADVISOR,
    });

    assert.equal(r.ok, true);
    assert.equal(disk.readStore().projectAdvisors.length, 0);
    // Unlike removing a member, nothing hangs off an advisor row.
    assert.equal(disk.readStore().deliverables.length, deliverablesBefore);
  });

  test("removing somebody who isn't listed says so", async () => {
    const r = await ops.removeProjectAdvisor({
      projectId: PROJECT,
      memberId: ADVISOR,
    });
    assert.equal(r.ok, false);
  });
});

/*
  The invariant that makes the role safe: an advisor sits outside the reporting
  chain in BOTH directions. A Lead converted into one would otherwise keep a
  review queue they can no longer reach, and the escalation — which runs on age
  — would point at somebody the app has stopped asking anything of.
*/
describe("becoming an advisor clears the reporting line", () => {
  test("their own Lead is dropped", async () => {
    const before = disk.readStore().members.find((m) => m.id === "m-tyler")!;
    assert.ok(before.leadId, "fixture needs somebody who reports to someone");

    await ops.setGlobalRole({ memberId: "m-tyler", role: "advisor" });

    const after = disk.readStore().members.find((m) => m.id === "m-tyler")!;
    assert.equal(after.leadId, null);
  });

  test("their reports are re-pointed upward, not orphaned", async () => {
    /*
      A `lead` specifically, not just anybody with reports.

      The first person in the seed who has reports is the Co-Lead, and
      converting the only active Co-Lead is refused by design — "the club is
      left with nobody who can appoint anyone". Picking them made this test
      assert against a write that never happened.
    */
    const seeded = disk.readStore();
    const lead = seeded.members.find(
      (m) =>
        m.globalRole === "lead" && seeded.members.some((x) => x.leadId === m.id)
    )!;
    assert.ok(lead, "seed needs a Team Lead with reports");
    const reports = seeded.members
      .filter((m) => m.leadId === lead.id)
      .map((m) => m.id);
    /*
      Copied out BEFORE the write, not read off `lead` afterwards.

      `readStore()` hands back the live in-memory objects, so `lead` is the same
      row `setGlobalRole` mutates — and the conversion sets an advisor's own
      `leadId` to null. Reading it after the fact compares the reports against
      null instead of against where they should have moved.
    */
    const grandLead = lead.leadId;

    await ops.setGlobalRole({ memberId: lead.id, role: "advisor" });

    const store = disk.readStore();
    for (const id of reports) {
      const m = store.members.find((x) => x.id === id)!;
      assert.notEqual(m.leadId, lead.id, `${id} still reports to an advisor`);
      assert.equal(m.leadId, grandLead, `${id} should move up a level`);
    }
  });
});

describe("asking a Lead for something", () => {
  const LEAD = "m-priya";
  const NOW = "2026-08-10T12:00:00.000Z";

  async function ask(body = "Access to the Fusion team drive") {
    return ops.createMemberRequest({
      memberId: MEMBER,
      leadId: LEAD,
      body,
      now: NOW,
    });
  }

  test("a blank body is refused", async () => {
    const r = await ops.createMemberRequest({
      memberId: MEMBER,
      leadId: LEAD,
      body: "   ",
      now: NOW,
    });
    assert.equal(r.ok, false);
  });

  test("it starts pending, with no answer attached", async () => {
    const r = await ask();
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.status, "pending");
      assert.equal(r.value.response, undefined);
      assert.equal(r.value.respondedAt, undefined);
    }
  });

  /*
    Not a technical limit — a guard against the thing that actually happens,
    which is pressing the button again because nothing visibly changed.
  */
  test("a second open request to the same person is refused", async () => {
    assert.equal((await ask()).ok, true);
    const again = await ask("Actually, the GitHub org too");
    assert.equal(again.ok, false);
    assert.equal(disk.readStore().memberRequests.length, 1);
  });

  test("but asking a DIFFERENT person is fine", async () => {
    assert.equal((await ask()).ok, true);
    const other = await ops.createMemberRequest({
      memberId: MEMBER,
      leadId: "m-anish",
      body: "Onshape seat",
      now: NOW,
    });
    assert.equal(other.ok, true);
  });

  test("asking somebody inactive is refused — they'd never see it", async () => {
    await ops.setMemberStatus({ memberId: LEAD, status: "inactive" });
    const r = await ask();
    assert.equal(r.ok, false);
  });

  test("granting needs no reason — the grant is the answer", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);

    const r = await ops.answerMemberRequest({
      requestId: created.value.id,
      status: "granted",
      response: "",
      responderId: LEAD,
      now: NOW,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.status, "granted");
      assert.equal(r.value.respondedBy, LEAD);
      assert.ok(r.value.respondedAt);
    }
  });

  /*
    The asymmetry is the point. A bare no is what stops somebody asking next
    time, and "not yet, do the training first" is usually the real answer.
  */
  test("declining without a reason is refused", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);

    const r = await ops.answerMemberRequest({
      requestId: created.value.id,
      status: "declined",
      response: "  ",
      responderId: LEAD,
      now: NOW,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Say why/);
  });

  test("declining with a reason keeps the reason", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);

    const r = await ops.answerMemberRequest({
      requestId: created.value.id,
      status: "declined",
      response: "Not until you're signed off on the mill.",
      responderId: LEAD,
      now: NOW,
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.match(r.value.response!, /signed off on the mill/);
  });

  test("answering twice is refused", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);
    const args = {
      requestId: created.value.id,
      status: "granted" as const,
      response: "",
      responderId: LEAD,
      now: NOW,
    };
    assert.equal((await ops.answerMemberRequest(args)).ok, true);
    assert.equal((await ops.answerMemberRequest(args)).ok, false);
  });

  test("answering clears the way for a new request", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);
    await ops.answerMemberRequest({
      requestId: created.value.id,
      status: "granted",
      response: "",
      responderId: LEAD,
      now: NOW,
    });
    // Only OPEN requests block a new one — otherwise one ask would be all
    // anybody ever got.
    assert.equal((await ask("And the GitHub org")).ok, true);
  });

  test("only the asker can withdraw", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);

    const notMine = await ops.withdrawMemberRequest({
      requestId: created.value.id,
      memberId: "m-omar",
    });
    assert.equal(notMine.ok, false);
    assert.equal(disk.readStore().memberRequests.length, 1);

    const mine = await ops.withdrawMemberRequest({
      requestId: created.value.id,
      memberId: MEMBER,
    });
    assert.equal(mine.ok, true);
    assert.equal(disk.readStore().memberRequests.length, 0);
  });

  test("an answered request can't be withdrawn", async () => {
    const created = await ask();
    if (!created.ok) throw new Error(created.error);
    await ops.answerMemberRequest({
      requestId: created.value.id,
      status: "granted",
      response: "",
      responderId: LEAD,
      now: NOW,
    });

    const r = await ops.withdrawMemberRequest({
      requestId: created.value.id,
      memberId: MEMBER,
    });
    assert.equal(r.ok, false);
  });
});
