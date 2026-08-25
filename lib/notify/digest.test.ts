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
 *   3. PL authority is inherited, not matched against `reIds`.
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

  test("a PL does", async () => {
    await connectEveryone();
    const re = disk.readStore().projects.find((p) => p.reIds.length > 0)!
      .reIds[0];
    assert.ok(build().some((d) => d.memberId === re));
  });

  test("opting out removes them, even as a PL", async () => {
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
        description: "last thing anyone did here",
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
        description: "ran the tensile coupons",
      });
      return { ok: true as const, value: null };
    });

    const mine = build().find((d) => d.memberId === re);
    assert.ok(mine);
    assert.match(mine.body, /ran the tensile coupons/);

    /*
      Check THIS project's line specifically. A PL usually holds several, and
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

describe("PL authority is inherited", () => {
  test("a PL of a parent gets the child project in their digest", async () => {
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

/*
  =========================================================================
  What the club asked for on 2026-08-24, and the traps each one has.
  =========================================================================
*/

describe("your own work, two days out", () => {
  /** Put `count` of `owner`'s open deliverables on `date`. */
  async function dueOn(
    owner: string,
    date: string,
    count = 1,
    status = "in_progress"
  ) {
    await disk.mutate((s) => {
      const mine = s.deliverables.filter(
        (d) => d.ownerId === owner && d.status !== "done"
      );
      for (const d of mine.slice(0, count)) {
        d.dueDate = date;
        d.status = status as typeof d.status;
      }
      return { ok: true as const, value: null };
    });
  }

  function urgentFor(id: string, today = TODAY) {
    return digest
      .buildDigests({ today, graph: graph() })
      .find((d) => d.memberId === id)?.urgent;
  }

  function owner() {
    return disk.readStore().deliverables.find((d) => d.status !== "done")!
      .ownerId;
  }

  test("fires on exactly two days out", async () => {
    await connectEveryone();
    const who = owner();
    await dueOn(who, addDays(TODAY, digest.DUE_NUDGE_DAYS));

    assert.match(urgentFor(who) ?? "", /due in 2 days/);
  });

  /*
    The whole reason the window is EXACT rather than "within". `<=` would fire
    tomorrow as well, and again every day it ran late, which is a countdown
    clock rather than a nudge — and it would need a database column to
    remember. One day only means it cannot repeat.
  */
  test("does not fire the day before, or the day after", async () => {
    await connectEveryone();
    const who = owner();

    await dueOn(who, addDays(TODAY, digest.DUE_NUDGE_DAYS));
    assert.equal(urgentFor(who, addDays(TODAY, -1)), undefined);
    assert.equal(urgentFor(who, addDays(TODAY, 1)), undefined);
  });

  /*
    Submitted work is waiting on a PL. The member has finished their half, so
    nudging them about the date blames them for somebody else's queue.
  */
  test("submitted work is not nudged", async () => {
    await connectEveryone();
    const who = owner();
    await dueOn(who, addDays(TODAY, digest.DUE_NUDGE_DAYS), 99, "submitted");

    assert.equal(urgentFor(who), undefined);
  });

  test("blocked work IS nudged — the date is still the unresolved part", async () => {
    await connectEveryone();
    const who = owner();
    await dueOn(who, addDays(TODAY, digest.DUE_NUDGE_DAYS), 1, "blocked");

    assert.ok(urgentFor(who));
  });

  /*
    Three deliverables sharing a Thursday is ONE calendar fact. Three DMs about
    it is the shape that gets a bot muted. (Contrast the assignment DMs, which
    the club explicitly wanted one-per-thing: those are three decisions
    somebody else made.)
  */
  test("several on the same day are one message, not one each", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const counts = new Map<string, number>();
    for (const d of store.deliverables) {
      if (d.status !== "done")
        counts.set(d.ownerId, (counts.get(d.ownerId) ?? 0) + 1);
    }
    const busy = [...counts.entries()].find(([, n]) => n >= 3)?.[0];
    if (!busy) return; // fixture has nobody with three; nothing to assert

    await dueOn(busy, addDays(TODAY, digest.DUE_NUDGE_DAYS), 3);

    const urgent = urgentFor(busy)!;
    assert.match(urgent, /3 things you own/);
    assert.equal(
      urgent.split("\n").filter((l) => l.startsWith("\u2022")).length,
      3
    );
  });

  /*
    Somebody else's deadline on their own project is a fact the recipient
    cannot act on. The deadline SECTION covers that; this DM is for work the
    member owns.
  */
  test("it is about work you own, not work on your projects", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const project = store.projects.find(
      (p) => p.reIds.length > 0 && p.phase !== "complete"
    )!;
    const pl = project.reIds[0];
    const notPl = store.deliverables.find(
      (d) =>
        d.projectId === project.id && d.ownerId !== pl && d.status !== "done"
    );
    if (!notPl) return;

    await dueOn(notPl.ownerId, addDays(TODAY, digest.DUE_NUDGE_DAYS));

    assert.ok(urgentFor(notPl.ownerId), "the owner is told");
    assert.equal(urgentFor(pl), undefined, "the PL is not");
  });

  /*
    The nudge rides the digest's `daily_digest_sent_on` claim, so `body` may be
    empty. The sender must not treat that as a failure and release the day.
  */
  test("a record with only a nudge has an empty body, not a header-only one", async () => {
    await connectEveryone();
    const who = owner();
    await dueOn(who, addDays(TODAY, digest.DUE_NUDGE_DAYS));

    const record = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === who)!;

    if (!record.body) return; // this fixture always has sections too
    assert.match(record.body, /SkyRunners/);
  });
});

describe("needs attention", () => {
  function sectionFor(id: string) {
    return (
      digest
        .buildDigests({ today: TODAY, graph: graph() })
        .find((d) => d.memberId === id)?.body ?? ""
    );
  }

  /** Somebody who is a PL of two or more live projects. */
  function multiPl() {
    const store = disk.readStore();
    const counts = new Map<string, number>();
    for (const p of store.projects) {
      if (p.phase === "complete") continue;
      for (const re of p.reIds) counts.set(re, (counts.get(re) ?? 0) + 1);
    }
    return [...counts.entries()].find(([, n]) => n >= 2)?.[0];
  }

  test("names the blocked and at-risk ones", async () => {
    await connectEveryone();
    const pl = multiPl();
    if (!pl) return;

    await disk.mutate((s) => {
      const theirs = s.projects.filter(
        (p) => p.reIds.includes(pl) && p.phase !== "complete"
      );
      theirs[0].health = "blocked";
      for (const p of theirs.slice(1)) p.health = "on_track";
      return { ok: true as const, value: null };
    });

    const body = sectionFor(pl);
    assert.match(body, /Needs attention/);
    assert.match(
      body,
      new RegExp(
        escapeRegExp(
          disk.readStore().projects.find((p) => p.health === "blocked")!.name
        )
      )
    );
  });

  /*
    A line that cannot change is a line people learn to skip, and it takes the
    sections under it with it. "3 on track" every evening for a year is that
    line. Nothing wrong is also the default assumption.
  */
  test("silent when nothing needs attention", async () => {
    await connectEveryone();
    const pl = multiPl();
    if (!pl) return;

    await disk.mutate((s) => {
      for (const p of s.projects) p.health = "on_track";
      return { ok: true as const, value: null };
    });

    assert.doesNotMatch(sectionFor(pl), /Needs attention/);
  });

  test("silent for somebody with one project — the roll call already said it", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const counts = new Map<string, number>();
    for (const p of store.projects) {
      if (p.phase === "complete") continue;
      for (const re of p.reIds) counts.set(re, (counts.get(re) ?? 0) + 1);
    }
    const single = [...counts.entries()].find(([, n]) => n === 1)?.[0];
    if (!single) return;

    await disk.mutate((s) => {
      for (const p of s.projects)
        if (p.reIds.includes(single)) p.health = "blocked";
      return { ok: true as const, value: null };
    });

    assert.doesNotMatch(sectionFor(single), /Needs attention/);
  });
});

describe("weekly sections", () => {
  /*
    Monday, and only Monday. Daily would turn a three-week silence into a
    twenty-one day nag.

    Fixed dates rather than arithmetic on a weekday, because the whole point of
    `lib/dates.ts` is that "what day is it" has exactly one implementation.
    2026-08-24 is a Monday; 2026-08-25 is a Tuesday.
  */
  const MONDAY = "2026-08-24";
  const TUESDAY = "2026-08-25";

  function bodies(today: string) {
    return digest
      .buildDigests({ today, graph: graph() })
      .map((d) => d.body)
      .join("\n");
  }

  test("gone quiet appears on Monday", async () => {
    await connectEveryone();
    assert.match(bodies(MONDAY), /Quiet for/);
  });

  test("and on no other day", async () => {
    await connectEveryone();
    assert.doesNotMatch(bodies(TUESDAY), /Quiet for/);
  });
});

describe("a project appearing", () => {
  test("shows up the day it starts, and the day after", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const pl = store.projects.find((p) => p.reIds.length > 0)!.reIds[0];

    await disk.mutate((s) => {
      const p = s.projects.find((x) => x.reIds.includes(pl))!;
      p.startDate = TODAY;
      return { ok: true as const, value: null };
    });

    const body = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === pl)!.body;

    assert.match(body, /project was added|projects were added/);
  });

  test("and not a week later", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const pl = store.projects.find((p) => p.reIds.length > 0)!.reIds[0];

    await disk.mutate((s) => {
      for (const p of s.projects) p.startDate = addDays(TODAY, -7);
      return { ok: true as const, value: null };
    });

    const body = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === pl)!.body;

    assert.doesNotMatch(body, /projects? (was|were) added/);
  });
});

describe("order survives the trim", () => {
  /*
    `clamp()` cuts from the bottom, so section order decides what a long digest
    loses. Found by rendering the real fixture: the only overflowing digest was
    the Co-Lead's with twelve projects, and what it dropped was the WEEKLY quiet
    section — the one thing they see once a week. The roll call of names was
    safe at the top, repeating "quiet today" twelve times.
  */
  test("the roll call is last, so a trim eats names and not problems", async () => {
    await connectEveryone();

    const store = disk.readStore();
    const co = store.members.find((m) => m.globalRole === "co_lead")!;

    await disk.mutate((s) => {
      s.projects[0].health = "blocked";
      return { ok: true as const, value: null };
    });

    const body = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === co.id)!.body;

    const attention = body.indexOf("Needs attention");
    const rollCall = body.indexOf("Your projects");
    assert.ok(attention >= 0, "the Co-Lead sees what needs attention");
    assert.ok(
      rollCall < 0 || attention < rollCall,
      "and sees it before the roll call"
    );
  });

  /*
    The same trap as the empty dashboard, and it has now been hit twice.
    `isREofOrAbove` has no Co-Lead shortcut: the Co-Lead answer lives in the
    `can.*` rules. Scoping by it alone gives the club's only Co-Lead — who is PL
    of 0 of 12 projects — nothing at all.
  */
  test("a Co-Lead who is PL of nothing still gets a digest", async () => {
    await connectEveryone();

    await disk.mutate((s) => {
      const co = s.members.find((m) => m.globalRole === "co_lead")!;
      for (const p of s.projects) {
        p.reIds = p.reIds.filter((id) => id !== co.id);
        if (p.primaryReId === co.id) p.primaryReId = p.reIds[0];
      }
      s.projectMemberships = s.projectMemberships.filter(
        (m) => m.memberId !== co.id
      );
      for (const team of s.teams)
        if (team.leadId === co.id) team.leadId = undefined;
      return { ok: true as const, value: null };
    });

    const co = disk
      .readStore()
      .members.find((m) => m.globalRole === "co_lead")!;
    const mine = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === co.id);

    assert.ok(mine, "a Co-Lead's scope is the club, not their PL rows");
    assert.match(mine.body, /Your projects/);
  });
});

describe("trainings to verify", () => {
  async function request() {
    await disk.mutate((s) => {
      const item = s.catalogueItems[0];
      const who = s.members.find((m) => m.globalRole === "member")!;
      s.certifications.push({
        id: "cert-digest-test",
        memberId: who.id,
        itemId: item.id,
        status: "requested",
        completedAt: TODAY,
        requestedAt: `${TODAY}T10:00:00.000Z`,
      });
      return { ok: true as const, value: null };
    });
  }

  test("leadership sees the queue", async () => {
    await connectEveryone();
    await request();

    const store = disk.readStore();
    const lead = store.members.find(
      (m) =>
        m.globalRole !== "member" &&
        store.projects.some((p) => p.reIds.includes(m.id))
    );
    if (!lead) return;

    const body = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .find((d) => d.memberId === lead.id)?.body;

    assert.match(body ?? "", /Trainings to verify/);
  });

  test("a plain member does not", async () => {
    await connectEveryone();
    await request();

    const bodies = digest.buildDigests({ today: TODAY, graph: graph() });
    for (const d of bodies) {
      const m = mock.getMember(d.memberId);
      if (m?.globalRole === "member") {
        assert.doesNotMatch(d.body, /Trainings to verify/);
      }
    }
  });

  /*
    Nothing to verify says nothing. The section exists because the club chose a
    queue line over a DM per verification, and a queue line that is always
    there stops being a queue.
  */
  test("an empty queue is silent", async () => {
    await connectEveryone();

    const bodies = digest
      .buildDigests({ today: TODAY, graph: graph() })
      .map((d) => d.body)
      .join("\n");

    assert.doesNotMatch(bodies, /Trainings to verify/);
  });
});

function addDays(iso: string, days: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
