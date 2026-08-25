/**
 * Who hears about a blocker.
 *
 * Run with:  npm test
 *
 * Three audiences on two different trees, and mixing them up is the easy
 * mistake:
 *
 *   - `blockerAudience` walks the PROJECT tree to find who can clear it.
 *   - `projectEscalationAudience` walks the same tree UPWARD, always, and only
 *     for a whole blocked project.
 *   - `raiserLeadAudience` walks the REPORTING tree, one step, for awareness.
 *
 * The rule none of them may break: **never notify the raiser about their own
 * blocker.** It's useless, it's the fastest way to get a bot muted, and it
 * hides the one case that most needs escalating — the person responsible for
 * clearing it being the person stuck.
 *
 * Same setup rules as the other store suites: `SKYRUNNERS_STORE_DIR` is set
 * BEFORE the store module is imported.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-audience-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let mock: typeof import("../mock-data.ts");
let disk: typeof import("../store/disk.ts");

before(async () => {
  mock = await import("../mock-data.ts");
  disk = await import("../store/disk.ts");
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

/** A project that has a parent, so the upward walk has somewhere to go. */
function nested() {
  const store = disk.readStore();
  const child = store.projects.find(
    (p) => p.parentId && store.projects.some((x) => x.id === p.parentId)
  );
  if (!child) throw new Error("fixture: no nested project");
  const parent = store.projects.find((p) => p.id === child.parentId)!;
  return { child, parent };
}

describe("projectEscalationAudience", () => {
  test("returns the parent's PLs, not the project's own", () => {
    const { child, parent } = nested();
    const raiser = child.reIds[0] ?? "nobody";

    const above = mock.projectEscalationAudience(child.id, raiser);
    for (const id of above) {
      assert.ok(
        parent.reIds.includes(id) || parent.primaryReId === id,
        `${id} is not a PL of the parent`
      );
    }
  });

  test("never includes the raiser", () => {
    /*
      The whole point. A PL marking their own project blocked must not be
      DMed about it — and if they're also a PL of the parent, the naive
      version does exactly that.
    */
    const { child, parent } = nested();
    const raiser = parent.primaryReId;

    assert.equal(
      mock.projectEscalationAudience(child.id, raiser).includes(raiser),
      false
    );
  });

  test("climbs past an unstaffed parent rather than giving up", () => {
    const { child, parent } = nested();

    // Strip the immediate parent of PLs; the walk should keep going.
    disk.resetStore();
    return disk
      .mutate((store) => {
        const p = store.projects.find((x) => x.id === parent.id)!;
        p.reIds = [];
        p.primaryReId = "";
        return { ok: true as const, value: null };
      })
      .then(() => {
        const above = mock.projectEscalationAudience(child.id, "nobody");
        // Either a grandparent's PL or the Division Lead — never empty when
        // the division has a lead, because "nobody hears" is the failure.
        const division = mock.divisionForProject(child.id);
        if (division?.leadId) assert.ok(above.length > 0);
      });
  });

  test("a root project with no parent falls back to the Division Lead", () => {
    const store = disk.readStore();
    const root = store.projects.find((p) => !p.parentId);
    if (!root) return;

    const division = mock.divisionForProject(root.id);
    const above = mock.projectEscalationAudience(root.id, "nobody");

    if (division?.leadId) {
      assert.deepEqual(above, [division.leadId]);
    } else {
      assert.deepEqual(above, []);
    }
  });
});

describe("raiserLeadAudience", () => {
  test("returns exactly the raiser's direct Lead", () => {
    const store = disk.readStore();
    const withLead = store.members.find(
      (m) => m.leadId && store.members.some((l) => l.id === m.leadId)
    );
    if (!withLead) return;

    assert.deepEqual(mock.raiserLeadAudience(withLead.id), [withLead.leadId]);
  });

  test("one step, not the whole chain", () => {
    /*
      A PL two levels up hearing about every blocker in their sub-tree is the
      noise that gets a bot muted. Something that actually SITS is handled by
      age instead: unconfirmed sign-offs and per-project silence both surface on
      the PL's dashboard by how long they have been waiting. (This used to name
      `lib/review.ts`, which escalated unread check-ins; it went with the
      reporting chain on 2026-08-24, and the age-not-count principle outlived
      it.)
    */
    const store = disk.readStore();
    const deep = store.members.find((m) => {
      const lead = store.members.find((l) => l.id === m.leadId);
      return lead?.leadId;
    });
    if (!deep) return;

    assert.equal(mock.raiserLeadAudience(deep.id).length, 1);
  });

  test("somebody with no Lead notifies nobody", () => {
    const store = disk.readStore();
    const orphan = store.members.find((m) => !m.leadId);
    if (!orphan) return;
    assert.deepEqual(mock.raiserLeadAudience(orphan.id), []);
  });

  test("an inactive Lead is skipped rather than DMed", async () => {
    const store = disk.readStore();
    const withLead = store.members.find(
      (m) => m.leadId && store.members.some((l) => l.id === m.leadId)
    );
    if (!withLead) return;

    await disk.mutate((s) => {
      s.members.find((m) => m.id === withLead.leadId)!.status = "inactive";
      return { ok: true as const, value: null };
    });

    assert.deepEqual(mock.raiserLeadAudience(withLead.id), []);
  });
});

describe("the three lists stay distinct", () => {
  test("clearing and awareness are different questions", () => {
    /*
      `blockerAudience` answers "who fixes this" on the project tree;
      `raiserLeadAudience` answers "who looks after this person" on the
      reporting tree. They may overlap, but neither is derivable from the
      other — a member's Lead is very often not a PL of their projects, which
      is the whole reason the app keeps two hierarchies.
    */
    const store = disk.readStore();
    const project = store.projects.find((p) => p.reIds.length > 0)!;
    const member = store.members.find(
      (m) => m.leadId && !project.reIds.includes(m.id)
    );
    if (!member) return;

    const clearers = mock.blockerAudience(project.id, member.id);
    const leads = mock.raiserLeadAudience(member.id);

    assert.ok(clearers.length > 0);
    assert.equal(clearers.includes(member.id), false);
    assert.equal(leads.includes(member.id), false);
  });
});
