/**
 * Who hears that something is blocked.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * The rule that needs pinning
 * ---------------------------------------------------------------------------
 *
 * A blocker goes to the project's REs and no further — it's a request for one
 * named person to act, not an announcement, and telling five people produces
 * the bystander effect instead of a fix.
 *
 * The exception is the whole reason this function exists: **if the only RE is
 * the person who's stuck, it climbs one level.** Without that, an RE blocked on
 * their own deliverable gets DMed about their own blocker — useless — and the
 * one case that genuinely needs escalating becomes the one case nobody hears
 * about. That inversion is silent, which is why it's tested rather than trusted.
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

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-blockers-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let disk: typeof import("./store/disk.ts");
let blockerAudience: typeof import("./mock-data.ts").blockerAudience;

before(async () => {
  disk = await import("./store/disk.ts");
  ({ blockerAudience } = await import("./mock-data.ts"));
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

/** A project with a parent, so "one level up" has somewhere to go. */
function nestedProject() {
  const store = disk.readStore();
  const child = store.projects.find(
    (p) => p.parentId !== null && p.primaryReId
  );
  if (!child) throw new Error("seed needs a nested project with an RE");
  const parent = store.projects.find((p) => p.id === child.parentId);
  if (!parent) throw new Error("seed nesting is broken");
  return { child, parent };
}

describe("a blocker goes to the nearest level that isn't you", () => {
  test("a member's blocker goes to their project's RE", async () => {
    const { child } = nestedProject();
    // Somebody who is definitely not an RE here.
    const outsider = disk
      .readStore()
      .members.find((m) => !child.reIds.includes(m.id))!;

    const audience = blockerAudience(child.id, outsider.id);
    assert.ok(
      audience.includes(child.primaryReId),
      "the primary RE has to hear about it"
    );
  });

  test("the primary RE is first, since they're the go-to contact", async () => {
    const { child } = nestedProject();
    const outsider = disk
      .readStore()
      .members.find((m) => !child.reIds.includes(m.id))!;

    assert.equal(blockerAudience(child.id, outsider.id)[0], child.primaryReId);
  });

  /*
    The case the whole function exists for. An RE stuck on their own project
    would otherwise be told about their own blocker.
  */
  test("an RE blocked on their own project escalates one level up", async () => {
    const { child, parent } = nestedProject();

    // Strip the child down to a single RE, and make them the raiser.
    await disk.mutate((store) => {
      const p = store.projects.find((x) => x.id === child.id)!;
      p.reIds = [child.primaryReId];
      const up = store.projects.find((x) => x.id === parent.id)!;
      up.primaryReId = store.members.find(
        (m) => m.id !== child.primaryReId
      )!.id;
      up.reIds = [up.primaryReId];
      return null;
    });

    const audience = blockerAudience(child.id, child.primaryReId);

    assert.ok(
      !audience.includes(child.primaryReId),
      "never tell somebody about their own blocker"
    );
    assert.ok(audience.length > 0, "it must reach SOMEBODY");
    assert.ok(
      audience.includes(
        disk.readStore().projects.find((p) => p.id === parent.id)!.primaryReId
      ),
      "it should land on the RE one level up"
    );
  });

  test("a co-RE at the same level is enough — it doesn't climb past them", async () => {
    const { child } = nestedProject();
    const other = disk
      .readStore()
      .members.find((m) => m.id !== child.primaryReId)!;

    await disk.mutate((store) => {
      const p = store.projects.find((x) => x.id === child.id)!;
      p.reIds = [child.primaryReId, other.id];
      return null;
    });

    // The primary raises it; their co-RE is right there and closer to the work
    // than anybody above.
    const audience = blockerAudience(child.id, child.primaryReId);
    assert.deepEqual(audience, [other.id]);
  });

  test("the raiser is never in the audience, whoever they are", async () => {
    const store = disk.readStore();
    for (const project of store.projects.slice(0, 6)) {
      for (const raiser of [project.primaryReId, store.members[0].id]) {
        assert.ok(
          !blockerAudience(project.id, raiser).includes(raiser),
          `${project.name} leaked the raiser back to themselves`
        );
      }
    }
  });

  test("an unknown project is silence, not a throw", async () => {
    assert.deepEqual(blockerAudience("p-does-not-exist", "m-anish"), []);
  });

  /*
    `parentId` is a plain column with no constraint against loops, same as
    everywhere else the trees are walked. A cycle has to fail the request, not
    hang it — an unresponsive server is much worse than a missing DM.
  */
  test("a project cycle doesn't hang the walk", async () => {
    const { child } = nestedProject();

    await disk.mutate((store) => {
      const p = store.projects.find((x) => x.id === child.id)!;
      p.reIds = [];
      p.primaryReId = "";
      p.parentId = child.id; // its own parent
      return null;
    });

    // Returns whatever it can find above — the point is that it returns.
    const audience = blockerAudience(child.id, "m-anish");
    assert.ok(Array.isArray(audience));
  });
});
