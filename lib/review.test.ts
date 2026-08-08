/**
 * Tests for review escalation.
 *
 * Run with:  npm test
 *
 * The rule being protected: a report that nobody reads must become somebody
 * else's problem, on a predictable schedule, naming one person.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  REVIEW_GRACE_DAYS,
  escalationsFor,
  reviewRecordFor,
  pendingSignOffs,
  unreadReportsFor,
} from "./review.ts";
import type { Member, ProgressUpdate } from "./types.ts";

const TODAY = "2026-08-10";

function member(id: string, leadId: string | null, role: Member["globalRole"] = "member"): Member {
  return {
    id,
    fullName: id,
    email: `${id}@stanford.edu`,
    globalRole: role,
    status: "active",
    leadId,
    joinedAt: "2026-01-01",
  };
}

function update(
  id: string,
  memberId: string,
  status: ProgressUpdate["status"],
  submittedAt?: string
): ProgressUpdate {
  return {
    id,
    memberId,
    dueAt: "2026-08-01",
    submittedAt,
    status,
    entries: [],
    hoursThisPeriod: 0,
  };
}

// coLead → lead → worker1, worker2
const coLead = member("coLead", null, "co_lead");
const lead = member("lead", "coLead", "lead");
const worker1 = member("worker1", "lead");
const worker2 = member("worker2", "lead");
const ALL = [coLead, lead, worker1, worker2];

describe("a Lead's unread queue", () => {
  test("only submitted reports are waiting on a human", () => {
    const updates = [
      update("u1", "worker1", "submitted", "2026-08-09"),
      update("u2", "worker2", "pending"),
      update("u3", "worker2", "reviewed", "2026-08-09"),
      update("u4", "worker1", "missed"),
    ];
    const unread = unreadReportsFor("lead", updates, [worker1, worker2], TODAY);
    assert.deepEqual(
      unread.map((r) => r.update.id),
      ["u1"]
    );
  });

  test("only reports from your OWN people appear", () => {
    // Someone else's report is not the Lead's obligation, and showing it would
    // make the queue impossible to clear.
    const stranger = member("stranger", "coLead");
    const updates = [update("u1", "stranger", "submitted", "2026-08-09")];
    assert.deepEqual(
      unreadReportsFor("lead", updates, [worker1, worker2], TODAY),
      []
    );
    assert.equal(
      unreadReportsFor("coLead", updates, [stranger], TODAY).length,
      1
    );
  });

  test("oldest first — the worst case is what you see", () => {
    const updates = [
      update("fresh", "worker1", "submitted", "2026-08-09"),
      update("stale", "worker2", "submitted", "2026-08-01"),
    ];
    const unread = unreadReportsFor("lead", updates, [worker1, worker2], TODAY);
    assert.deepEqual(
      unread.map((r) => r.update.id),
      ["stale", "fresh"]
    );
  });

  test("age is counted in whole days from submission", () => {
    const updates = [update("u1", "worker1", "submitted", "2026-08-07")];
    assert.equal(
      unreadReportsFor("lead", updates, [worker1], TODAY)[0].ageDays,
      3
    );
  });

  test("a report submitted today is 0 days old, never negative", () => {
    const updates = [update("u1", "worker1", "submitted", TODAY)];
    const [r] = unreadReportsFor("lead", updates, [worker1], TODAY);
    assert.equal(r.ageDays, 0);
    assert.equal(r.escalated, false);
  });

  test("falls back to the due date when submittedAt is missing", () => {
    // Shouldn't happen — 0007 has a CHECK for it — but mock data is looser and
    // NaN here would silently sort the queue wrong.
    const updates = [update("u1", "worker1", "submitted")];
    const [r] = unreadReportsFor("lead", updates, [worker1], TODAY);
    assert.ok(Number.isFinite(r.ageDays));
    assert.equal(r.ageDays, 9); // dueAt 2026-08-01 → 2026-08-10
  });
});

describe("the grace period", () => {
  test(`escalates at exactly ${REVIEW_GRACE_DAYS} days, not before`, () => {
    function ageOf(submittedAt: string) {
      const updates = [update("u1", "worker1", "submitted", submittedAt)];
      return unreadReportsFor("lead", updates, [worker1], TODAY)[0];
    }
    assert.equal(ageOf("2026-08-08").escalated, false); // 2 days
    assert.equal(ageOf("2026-08-07").escalated, true); // 3 days — boundary
    assert.equal(ageOf("2026-08-01").escalated, true); // 9 days
  });
});

describe("escalation names one Lead, not a pile of reports", () => {
  test("the Lead above sees which of their Leads is behind", () => {
    const updates = [
      update("u1", "worker1", "submitted", "2026-08-01"), // 9 days
      update("u2", "worker2", "submitted", "2026-08-06"), // 4 days
    ];
    const escalations = escalationsFor("coLead", ALL, updates, TODAY);

    assert.equal(escalations.length, 1);
    assert.equal(escalations[0].lead.id, "lead");
    assert.equal(escalations[0].overdue.length, 2);
    assert.equal(escalations[0].worstAgeDays, 9);
  });

  test("nothing to report is an empty array, so the UI can say nothing", () => {
    const updates = [update("u1", "worker1", "submitted", "2026-08-09")];
    assert.deepEqual(escalationsFor("coLead", ALL, updates, TODAY), []);
  });

  test("a Lead who has read everything does not appear", () => {
    const updates = [update("u1", "worker1", "reviewed", "2026-08-01")];
    assert.deepEqual(escalationsFor("coLead", ALL, updates, TODAY), []);
  });

  test("only reports on your OWN Leads, not the whole club", () => {
    // otherLead reports to nobody the viewer oversees.
    const otherLead = member("otherLead", null, "lead");
    const theirReport = member("theirReport", "otherLead");
    const updates = [update("u1", "theirReport", "submitted", "2026-08-01")];
    assert.deepEqual(
      escalationsFor("coLead", [...ALL, otherLead, theirReport], updates, TODAY),
      []
    );
  });

  test("plain members are never escalated about — they lead nobody", () => {
    const updates = [update("u1", "worker1", "submitted", "2026-08-01")];
    // worker2 is a member reporting to `lead`; escalating about them would be
    // meaningless since nobody reports to them.
    const escalations = escalationsFor("lead", ALL, updates, TODAY);
    assert.deepEqual(escalations, []);
  });

  test("worst offender first", () => {
    const leadA = member("leadA", "coLead", "lead");
    const leadB = member("leadB", "coLead", "lead");
    const a1 = member("a1", "leadA");
    const b1 = member("b1", "leadB");
    const updates = [
      update("ua", "a1", "submitted", "2026-08-06"), // 4 days
      update("ub", "b1", "submitted", "2026-08-01"), // 9 days
    ];
    const escalations = escalationsFor(
      "coLead",
      [coLead, leadA, leadB, a1, b1],
      updates,
      TODAY
    );
    assert.deepEqual(
      escalations.map((e) => e.lead.id),
      ["leadB", "leadA"]
    );
  });
});

describe("work waiting on an RE's sign-off", () => {
  function deliverable(
    id: string,
    status: "open" | "submitted" | "done",
    projectId: string,
    submittedAt?: string
  ) {
    return {
      id,
      projectId,
      title: id,
      ownerId: "worker1",
      status,
      submittedAt,
      sortOrder: 1,
    };
  }

  test("only submitted work is waiting on anyone", () => {
    const items = pendingSignOffs(
      [
        deliverable("d1", "submitted", "p1", "2026-08-09"),
        deliverable("d2", "open", "p1"),
        deliverable("d3", "done", "p1", "2026-08-01"),
      ],
      ["p1"],
      ALL,
      TODAY
    );
    assert.deepEqual(
      items.map((i) => i.deliverable.id),
      ["d1"]
    );
  });

  test("only projects in the RE's subtree count", () => {
    const items = pendingSignOffs(
      [deliverable("d1", "submitted", "someone-elses", "2026-08-01")],
      ["p1"],
      ALL,
      TODAY
    );
    assert.deepEqual(items, []);
  });

  test("it escalates on the same grace period as an unread check-in", () => {
    // Same threshold on purpose: both are "a person is waiting on one named
    // human", and two different clocks would be arbitrary.
    const items = pendingSignOffs(
      [
        deliverable("old", "submitted", "p1", "2026-08-01"), // 9 days
        deliverable("new", "submitted", "p1", "2026-08-09"), // 1 day
      ],
      ["p1"],
      ALL,
      TODAY
    );
    assert.equal(items[0].deliverable.id, "old"); // oldest first
    assert.equal(items[0].escalated, true);
    assert.equal(items[1].escalated, false);
    assert.equal(items[0].ageDays, REVIEW_GRACE_DAYS + 6);
  });

  test("the owner is resolved, so the UI can name who's waiting", () => {
    const items = pendingSignOffs(
      [deliverable("d1", "submitted", "p1", "2026-08-01")],
      ["p1"],
      ALL,
      TODAY
    );
    assert.equal(items[0].owner?.id, "worker1");
  });
});

describe("a Lead's own record", () => {
  test("counts unread and escalated separately", () => {
    const updates = [
      update("u1", "worker1", "submitted", "2026-08-01"), // 9 days, escalated
      update("u2", "worker2", "submitted", "2026-08-09"), // 1 day, not
    ];
    const record = reviewRecordFor("lead", updates, [worker1, worker2], TODAY);
    assert.equal(record.unread, 2);
    assert.equal(record.escalated, 1);
    assert.equal(record.worstAgeDays, 9);
  });

  test("all clear reads as zeroes, not as absent data", () => {
    const record = reviewRecordFor("lead", [], [worker1, worker2], TODAY);
    assert.deepEqual(record, { unread: 0, escalated: 0, worstAgeDays: 0 });
  });
});
