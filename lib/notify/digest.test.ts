/**
 * The daily digest.
 *
 * Run with:  npm test
 *
 * The rules worth pinning are the ones that decide whether people keep reading
 * it. A digest nobody reads is worse than none, because muting it mutes the
 * blocker alerts too.
 *
 *   1. Nothing to say → nothing sent.
 *   2. A quiet project says HOW LONG it has been quiet.
 *   3. RE authority is inherited, not matched against `reIds`.
 *   4. It never exceeds Discord's message limit.
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

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-digest-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let digest: typeof import("./digest.ts");
let disk: typeof import("../store/disk.ts");
let mock: typeof import("../mock-data.ts");

const TODAY = "2026-08-12";

before(async () => {
  digest = await import("./digest.ts");
  disk = await import("../store/disk.ts");
  mock = await import("../mock-data.ts");
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

function graph() {
  return {
    getMember: mock.getMember,
    getProject: mock.getProject,
    directREs: mock.directREs,
    getTeam: mock.getTeam,
  };
}

function build(skip?: Set<string>) {
  return digest.buildDigests({ today: TODAY, graph: graph(), skip });
}

/** Give everyone a Discord id, since no id means no digest by design. */
async function connectEveryone() {
  await disk.mutate((store) => {
    for (const m of store.members) m.discordUserId = `d-${m.id}`;
    return { ok: true as const, value: null };
  });
}

describe("who gets one at all", () => {
  test("a member with no Discord id never does", async () => {
    // Nothing to send to. Also the reason `connectEveryone` exists.
    const none = build();
    assert.equal(
      none.every((d) => d.discordUserId),
      true
    );
  });

  test("a plain member with no projects and no reports gets nothing", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const plain = store.members.find(
      (m) =>
        m.status === "active" &&
        m.globalRole === "member" &&
        !store.teams.some((t) => t.leadId === m.id) &&
        !store.members.some((r) => r.leadId === m.id) &&
        !store.projects.some((p) => p.reIds.includes(m.id))
    );

    if (!plain) return; // fixture has none; nothing to assert
    assert.equal(
      build().some((d) => d.memberId === plain.id),
      false
    );
  });

  test("an RE does", async () => {
    await connectEveryone();
    const re = disk.readStore().projects.find((p) => p.reIds.length > 0)!
      .reIds[0];
    assert.ok(build().some((d) => d.memberId === re));
  });

  test("opting out removes them, even as an RE", async () => {
    await connectEveryone();
    const re = disk.readStore().projects.find((p) => p.reIds.length > 0)!
      .reIds[0];

    assert.equal(
      build(new Set([re])).some((d) => d.memberId === re),
      false
    );
  });

  test("an inactive member never gets one", async () => {
    await connectEveryone();
    const store = disk.readStore();
    const re = store.projects.find((p) => p.reIds.length > 0)!.reIds[0];

    await disk.mutate((s) => {
      s.members.find((m) => m.id === re)!.status = "inactive";
      return { ok: true as const, value: null };
    });

    assert.equal(
      build().some((d) => d.memberId === re),
      false
    );
  });
});

describe("a quiet project says how long", () => {
  test("no activity today reports the last date and the gap", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    // One work log, four days back, and nothing since.
    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.projectId !== project.id);
      s.deliverables = s.deliverables.filter((d) => d.projectId !== project.id);
      s.projectArtifacts = s.projectArtifacts.filter(
        (a) => a.projectId !== project.id
      );
      s.progressUpdates = [];
      s.workLogs.push({
        id: "wl-quiet",
        memberId: re,
        projectId: project.id,
        workDate: "2026-08-08",
        hours: 2,
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.match(mine.body, /quiet today/);
    assert.match(mine.body, /2026-08-08/);
    // The GAP is the useful number — "4 days ago" is a prompt, a bare date
    // makes the reader do arithmetic.
    assert.match(mine.body, /4 days ago/);
  });

  test("activity today is listed instead", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.workLogs.push({
        id: "wl-today",
        memberId: re,
        projectId: project.id,
        workDate: TODAY,
        hours: 3,
        description: "ran the tensile coupons",
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.match(mine.body, /ran the tensile coupons/);

    /*
      Check THIS project's line specifically. An RE usually holds several, and
      the others being quiet is correct — an earlier version of this assertion
      searched the whole message and failed on a working digest.
    */
    const line = mine.body
      .split("\n")
      .find((l) => l.includes(project.name) && l.startsWith("**"));
    assert.ok(line, `no line for ${project.name}`);
    assert.equal(line.includes("quiet today"), false);
  });
});

describe("a future-dated entry is not a quiet project", () => {
  test("work dated tomorrow counts as current, not as silence", async () => {
    /*
      Found by rendering real digests against production, not by a test: a work
      log dated tomorrow wasn't matched by `=== today` but still set the
      last-activity date, so the line read

        "quiet today; last activity 2026-08-13 (today)"

      which contradicts itself in eight words. Future dates are real — the club
      runs on Pacific while the database is UTC, so a lab evening is already
      tomorrow in one of them.
    */
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.workLogs = s.workLogs.filter((w) => w.projectId !== project.id);
      s.deliverables = s.deliverables.filter((d) => d.projectId !== project.id);
      s.projectArtifacts = s.projectArtifacts.filter(
        (a) => a.projectId !== project.id
      );
      s.progressUpdates = [];
      s.workLogs.push({
        id: "wl-tomorrow",
        memberId: re,
        projectId: project.id,
        // One day AFTER `TODAY`.
        workDate: "2026-08-13",
        hours: 2,
        description: "logged ahead",
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);

    const line = mine.body
      .split("\n")
      .find((l) => l.includes(project.name) && l.startsWith("**"));
    assert.ok(line);
    assert.equal(line.includes("quiet today"), false);
    assert.match(mine.body, /logged ahead/);
  });
});

describe("deadlines inside the week", () => {
  test("a deliverable due in three days shows up", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.deliverables.push({
        id: "d-soon",
        projectId: project.id,
        title: "DIGEST DEADLINE PROBE",
        ownerId: re,
        dueDate: "2026-08-15",
        status: "in_progress",
        sortOrder: 999,
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.match(mine.body, /DIGEST DEADLINE PROBE/);
    assert.match(mine.body, /due in 3d/);
  });

  test("something due in a month does not", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.deliverables.push({
        id: "d-far",
        projectId: project.id,
        title: "FAR AWAY PROBE",
        ownerId: re,
        dueDate: "2026-11-01",
        status: "in_progress",
        sortOrder: 999,
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.equal(mine.body.includes("FAR AWAY PROBE"), false);
  });

  test("overdue work is included and marked, not hidden", async () => {
    /*
      A week late is more urgent than due Friday. Filtering to "future only"
      would make the section quietly wrong about the most important row in it.
    */
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.deliverables.push({
        id: "d-late",
        projectId: project.id,
        title: "OVERDUE PROBE",
        ownerId: re,
        dueDate: "2026-08-05",
        status: "in_progress",
        sortOrder: 999,
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.match(mine.body, /OVERDUE PROBE/);
    assert.match(mine.body, /7d OVERDUE/);
  });

  test("finished work never appears", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      s.deliverables.push({
        id: "d-done",
        projectId: project.id,
        title: "DONE PROBE",
        ownerId: re,
        dueDate: "2026-08-13",
        status: "done",
        sortOrder: 999,
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.equal(mine.body.includes("DONE PROBE"), false);
  });
});

describe("RE authority is inherited", () => {
  test("an RE of a parent gets the child project in their digest", async () => {
    /*
      The bug this guards: matching `reIds` directly instead of asking
      `isREofOrAbove`. It compiles, it looks right, and it silently drops every
      sub-project and every Division Lead — the shape CLAUDE.md warns about
      twice.
    */
    await connectEveryone();

    const store = disk.readStore();
    const child = store.projects.find(
      (p) => p.parentId && p.phase !== "complete"
    );
    if (!child) return; // fixture has no nested project

    const parent = store.projects.find((p) => p.id === child.parentId)!;
    const parentRE = parent.reIds.find((id) => !child.reIds.includes(id));
    if (!parentRE) return;

    const mine = build().find((d) => d.memberId === parentRE);
    assert.ok(mine);
    assert.match(mine.body, new RegExp(escapeRegExp(child.name)));
  });
});

describe("message length", () => {
  test("never exceeds Discord's limit, even with a lot to say", async () => {
    // Over 2000 characters and the DM fails outright — Discord does not
    // truncate it for you.
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      for (let i = 0; i < 120; i++) {
        s.deliverables.push({
          id: `d-flood-${i}`,
          projectId: project.id,
          title: `Flood deliverable number ${i} with a deliberately long title`,
          ownerId: re,
          dueDate: "2026-08-14",
          status: "in_progress",
          sortOrder: 1000 + i,
        });
      }
      return { ok: true as const, value: null };
    });

    for (const d of build()) {
      assert.ok(
        d.body.length <= digest.MAX_DM_CHARS,
        `${d.memberId} got ${d.body.length} chars`
      );
    }
  });

  test("a trimmed message says so rather than stopping mid-sentence", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.phase !== "complete" && p.reIds.length > 0
    )!;
    const re = project.reIds[0];

    await disk.mutate((s) => {
      for (let i = 0; i < 200; i++) {
        s.workLogs.push({
          id: `wl-flood-${i}`,
          memberId: re,
          projectId: project.id,
          workDate: TODAY,
          hours: 1,
          description: `a fairly long description of work number ${i}`,
        });
      }
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    if (mine.body.length >= digest.MAX_DM_CHARS - 50) {
      assert.match(mine.body, /trimmed/);
    }
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
