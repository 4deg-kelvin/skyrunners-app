/**
 * What "Needs Attention" notices, on both surfaces.
 *
 * Run with:  npm test
 *
 * These two used to be exact inverses of each other, which is the bug being
 * pinned here:
 *
 *   - the DASHBOARD (`projectsNeedingAttention`) filtered on `health` and never
 *     looked at deliverables, so somebody marking their work blocked produced
 *     "Every project is on track";
 *   - the PROJECT PAGE (`projectAttentionFlags`) looked at deliverables, RE
 *     silence and dates but never at `health`, so a project its RE had marked
 *     blocked raised no flag on the one page you'd open to find out why.
 *
 * Neither surface could be trusted on its own, and they disagreed about the
 * same project. Both directions are covered below.
 *
 * Same setup rules as the other store suites: `SKYRUNNERS_STORE_DIR` is set
 * BEFORE the store module is imported, because `disk.ts` resolves its path at
 * module scope and a static import would bind the developer's real `.data/`.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-attention-"));
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
    // Best effort — a leftover temp dir is harmless.
  }
});

/** A live, healthy project that owns at least one unfinished deliverable. */
function healthyProjectWithWork() {
  const store = disk.readStore();
  const project = store.projects.find(
    (p) =>
      p.health === "on_track" &&
      p.phase !== "complete" &&
      store.deliverables.some(
        (d) =>
          d.projectId === p.id && d.status !== "done" && d.status !== "blocked"
      )
  );
  if (!project) throw new Error("fixture: no healthy project with open work");
  return project;
}

function flagsFor(projectId: string) {
  return mock.projectAttentionFlags().filter((f) => f.projectId === projectId);
}

function reasonsFor(projectId: string) {
  return flagsFor(projectId).map((f) => f.reason);
}

function listed(projectId: string) {
  return mock.projectsNeedingAttention().some((p) => p.id === projectId);
}

async function setHealth(
  projectId: string,
  health: "on_track" | "at_risk" | "blocked"
) {
  // `mutate` returns a Promise. Forgetting to await it makes every assertion
  // below race the write and read the old store.
  await disk.mutate((store) => {
    const project = store.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("no such project");
    project.health = health;
    return { ok: true as const, value: null };
  });
}

async function blockADeliverable(projectId: string) {
  await disk.mutate((store) => {
    const deliverable = store.deliverables.find(
      (d) => d.projectId === projectId && d.status !== "done"
    );
    if (!deliverable) throw new Error("no open deliverable");
    deliverable.status = "blocked";
    deliverable.blockerNote = "Waiting on the laser cutter.";
    return { ok: true as const, value: null };
  });
}

describe("the dashboard notices a blocked DELIVERABLE", () => {
  test("a healthy project with open work starts off the list", async () => {
    const project = healthyProjectWithWork();
    assert.equal(listed(project.id), false);
  });

  test("blocking one deliverable puts the project on the list", async () => {
    /*
      THE bug. Before this, the section said "Every project is on track" while
      a member sat blocked, because the filter only ever read `health`.
    */
    const project = healthyProjectWithWork();
    await blockADeliverable(project.id);
    assert.equal(listed(project.id), true);
  });

  test("the project's own health is untouched by that", async () => {
    // Health is the RE's judgement. Surfacing a fact must not silently
    // overwrite an opinion — see the `past_target` reasoning.
    const project = healthyProjectWithWork();
    await blockADeliverable(project.id);
    const after = disk.readStore().projects.find((p) => p.id === project.id);
    assert.equal(after?.health, "on_track");
  });

  test("health alone still lists it, with no blocked deliverable", async () => {
    const project = healthyProjectWithWork();
    await setHealth(project.id, "blocked");
    assert.equal(listed(project.id), true);
  });

  test("at_risk still counts", async () => {
    const project = healthyProjectWithWork();
    await setHealth(project.id, "at_risk");
    assert.equal(listed(project.id), true);
  });

  test("a COMPLETED project never appears, however it's flagged", async () => {
    /*
      Guards the noise this change could have introduced: without the phase
      check, one stale blocked deliverable on a finished project would sit in
      the list forever, and a section containing something nobody will act on
      stops being read.
    */
    const project = healthyProjectWithWork();
    await blockADeliverable(project.id);
    await setHealth(project.id, "blocked");
    await disk.mutate((store) => {
      const p = store.projects.find((x) => x.id === project.id)!;
      p.phase = "complete";
      return { ok: true as const, value: null };
    });
    assert.equal(listed(project.id), false);
  });
});

describe("the project page notices its own HEALTH", () => {
  test("health_flagged is produced at all", async () => {
    /*
      It was a declared reason with a label and no producer for two phases —
      the SQL view emits it, the app reads this function, and nobody noticed
      because a missing flag looks exactly like a healthy project.
    */
    const project = healthyProjectWithWork();
    await setHealth(project.id, "blocked");
    assert.ok(reasonsFor(project.id).includes("health_flagged"));
  });

  test("at_risk raises it too, at a lower severity than blocked", async () => {
    const project = healthyProjectWithWork();

    await setHealth(project.id, "blocked");
    const blocked = flagsFor(project.id).find(
      (f) => f.reason === "health_flagged"
    );

    await setHealth(project.id, "at_risk");
    const atRisk = flagsFor(project.id).find(
      (f) => f.reason === "health_flagged"
    );

    assert.ok(blocked);
    assert.ok(atRisk);
    assert.ok(blocked.severity > atRisk.severity);
  });

  test("an on_track project raises nothing", async () => {
    const project = healthyProjectWithWork();
    assert.equal(reasonsFor(project.id).includes("health_flagged"), false);
  });

  test("a completed project raises nothing", async () => {
    const project = healthyProjectWithWork();
    await setHealth(project.id, "blocked");
    await disk.mutate((store) => {
      const p = store.projects.find((x) => x.id === project.id)!;
      p.phase = "complete";
      return { ok: true as const, value: null };
    });
    assert.equal(reasonsFor(project.id).includes("health_flagged"), false);
  });

  test("health and blocked deliverables are SEPARATE flags", async () => {
    /*
      Different claims, and a project is often one without the other: somebody
      recorded a stuck deliverable, versus the person accountable judging the
      whole project to be in trouble. Collapsing them would lose whichever the
      reader needed.
    */
    const project = healthyProjectWithWork();
    await blockADeliverable(project.id);
    await setHealth(project.id, "blocked");

    const reasons = reasonsFor(project.id);
    assert.ok(reasons.includes("health_flagged"));
    assert.ok(reasons.includes("blocker_stale"));
  });
});

describe("the two surfaces agree", () => {
  test("anything raising a flag on its page is on the dashboard list", async () => {
    /*
      The real regression guard. These drifted apart silently once and nothing
      caught it, because each one looked right in isolation.

      Only the reasons that mean "this project needs attention now" — an
      overdue deliverable or a past target date is a schedule problem the RE
      owns, and deliberately does not promote a project onto the leadership
      list.
    */
    const project = healthyProjectWithWork();
    for (const setup of [
      () => blockADeliverable(project.id),
      () => setHealth(project.id, "blocked"),
      () => setHealth(project.id, "at_risk"),
    ]) {
      disk.resetStore();
      await setup();
      assert.equal(listed(project.id), true);
    }
  });
});
