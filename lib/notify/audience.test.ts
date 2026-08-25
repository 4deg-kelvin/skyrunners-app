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

/*
  `describe("raiserLeadAudience")` was here -- five tests on who hears that one
  of their reports is blocked, one step up the reporting tree.

  It went with the notification layer's share of the reporting removal on
  2026-08-25. The function read `profiles.lead_id`, which nothing writes, so it
  was already returning nothing for anybody invited after 2026-08-24.
*/

describe("the two lists stay distinct", () => {
  test("clearing and escalating are different questions", () => {
    /*
      There were THREE lists until 2026-08-25: who clears it (the project's
      PLs), who owns the work above it, and who looks after the PERSON. The
      third read the reporting chain and went with it.

      The remaining two are still not derivable from each other, which is the
      point worth keeping: `blockerAudience` deliberately EXCLUDES the raiser and
      climbs one level if that empties the list, while
      `projectEscalationAudience` answers "whose promise does this change" and
      only fires for a whole project. A blocked deliverable earns the first and
      not the second.
    */
    const store = disk.readStore();
    const child = store.projects.find((p) => p.parentId && p.reIds.length > 0);
    if (!child) return;
    const raiser = child.reIds[0];

    const clearers = mock.blockerAudience(child.id, raiser);
    const above = mock.projectEscalationAudience(child.id, raiser);

    // Neither list ever contains the person who raised it.
    assert.equal(clearers.includes(raiser), false);
    assert.equal(above.includes(raiser), false);
  });
});
