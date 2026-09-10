/**
 * Project siblings use stable due-date order; divisions remain alphabetical.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this is worth a test
 * ---------------------------------------------------------------------------
 *
 * `/projects` is the discoverability page. Its whole job is that somebody can
 * find the work they're looking for — and the order used to be whatever
 * Postgres handed back, which is not merely arbitrary but **not stable**. Two
 * loads could list the divisions differently, so finding Airframe meant
 * reading the page top to bottom every single time.
 *
 * Ordering also fails silently. Nothing throws, nothing looks broken, and the
 * only way to notice is to be the person hunting for a project. A new call
 * site that filters the store by hand instead of going through
 * `childProjects()` would quietly reintroduce it, which is exactly what these
 * assertions are here to catch.
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

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-projects-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let disk: typeof import("../store/disk.ts");
let getProjectTree: typeof import("./projects.ts").getProjectTree;
let getProjectBySlug: typeof import("./projects.ts").getProjectBySlug;
let mock: typeof import("../mock-data.ts");

before(async () => {
  disk = await import("../store/disk.ts");
  ({ getProjectTree, getProjectBySlug } = await import("./projects.ts"));
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

/** True when every entry is <= the next one, by the same rule the app uses. */
function isSorted(names: string[]): boolean {
  return names.every(
    (name, i) => i === 0 || names[i - 1].localeCompare(name) <= 0
  );
}

/** Every project name in the tree, one array per nesting level walked. */
function allLevels(
  nodes: {
    project: { name: string; targetDate?: string };
    children: unknown[];
  }[]
): string[][] {
  if (nodes.length === 0) return [];
  const here = [
    nodes.map((n) => `${n.project.targetDate || "9999"} ${n.project.name}`),
  ];
  const below = nodes.flatMap((n) => allLevels(n.children as typeof nodes));
  return [...here, ...below];
}

describe("progress counts the whole subtree", () => {
  /*
    The club's report on 2026-09-08: a project's bar ignored its sub-projects,
    so a parent that breaks its work down into children — which is what a large
    project does — read 0% while dozens of its deliverables were finished. The
    bar was most wrong on the projects it mattered most for.
  */
  function ownOnly(projectId: string) {
    const s = disk.readStore();
    const own = s.deliverables.filter((d) => d.projectId === projectId);
    return {
      total: own.length,
      done: own.filter((d) => d.status === "done").length,
    };
  }

  test("a parent with no deliverables of its own inherits its children's", () => {
    const s = disk.readStore();
    const parent = s.projects.find(
      (p) =>
        s.projects.some((x) => x.parentId === p.id) &&
        !s.deliverables.some((d) => d.projectId === p.id)
    );
    if (!parent) return; // fixture has none; nothing to assert

    assert.equal(ownOnly(parent.id).total, 0, "it really holds none itself");

    const progress = mock.projectProgress(parent.id);
    assert.ok(progress.total > 0, "but the subtree has some");
    assert.equal(
      progress.fromSubProjects,
      progress.total,
      "all of them inherited"
    );
  });

  test("a parent's count is its own plus every descendant's", () => {
    const s = disk.readStore();
    const parent = s.projects.find((p) =>
      s.projects.some((x) => x.parentId === p.id)
    )!;

    const ids = new Set(mock.projectSubtreeIds(parent.id));
    const expected = s.deliverables.filter((d) => ids.has(d.projectId));

    const progress = mock.projectProgress(parent.id);
    assert.equal(progress.total, expected.length);
    assert.equal(
      progress.done,
      expected.filter((d) => d.status === "done").length
    );
  });

  test("it reaches grandchildren, not just direct children", () => {
    const s = disk.readStore();
    // A project whose child also has a child.
    const grandparent = s.projects.find((p) =>
      s.projects.some(
        (kid) =>
          kid.parentId === p.id && s.projects.some((g) => g.parentId === kid.id)
      )
    );
    if (!grandparent) return;

    const ids = mock.projectSubtreeIds(grandparent.id);
    const kidIds = s.projects
      .filter((x) => x.parentId === grandparent.id)
      .map((x) => x.id);
    const grandIds = s.projects
      .filter((x) => kidIds.includes(x.parentId ?? ""))
      .map((x) => x.id);

    for (const g of grandIds) {
      assert.ok(ids.includes(g), `${g} should be in the subtree`);
    }
  });

  test("a leaf project is unchanged", () => {
    const s = disk.readStore();
    const leaf = s.projects.find(
      (p) =>
        !s.projects.some((x) => x.parentId === p.id) &&
        s.deliverables.some((d) => d.projectId === p.id)
    )!;

    const progress = mock.projectProgress(leaf.id);
    assert.equal(progress.total, ownOnly(leaf.id).total);
    assert.equal(progress.done, ownOnly(leaf.id).done);
    assert.equal(progress.fromSubProjects, 0);
  });

  /*
    `parent_id` is a plain column, so a loop is representable. Everything else
    in this repo that walks a tree is cycle-guarded for the same reason: a hang
    is a worse failure than an error.
  */
  test("a cycle terminates instead of hanging", async () => {
    await disk.mutate((store) => {
      const [a, b] = store.projects;
      a.parentId = b.id;
      b.parentId = a.id;
      return { ok: true as const, value: null };
    });

    const s = disk.readStore();
    const ids = mock.projectSubtreeIds(s.projects[0].id);
    assert.ok(ids.length >= 1);
    assert.equal(new Set(ids).size, ids.length, "no id visited twice");
  });
});

describe("project siblings are ordered by due date", () => {
  test("divisions are in name order", async () => {
    const tree = await getProjectTree();
    const names = tree.map((d) => d.division.name);

    assert.ok(
      names.length > 1,
      "seed needs several divisions to be meaningful"
    );
    assert.ok(isSorted(names), `divisions out of order: ${names.join(", ")}`);
  });

  test("root projects inside each division are in due-date order", async () => {
    const tree = await getProjectTree();
    let checked = 0;

    for (const division of tree) {
      const names = division.roots.map(
        (r) => `${r.project.targetDate || "9999"} ${r.project.name}`
      );
      if (names.length > 1) checked++;
      assert.ok(
        isSorted(names),
        `${division.division.name}: ${names.join(", ")}`
      );
    }

    assert.ok(checked > 0, "seed needs a division with several projects");
  });

  /*
    The tree recurses through `childProjects()`, so sorting it once should hold
    all the way down. This walks every level rather than just the second,
    because "we sorted the top two levels" is the shape the bug comes back in.
  */
  test("sub-projects are in due-date order at every depth", async () => {
    const tree = await getProjectTree();

    for (const division of tree) {
      for (const level of allLevels(division.roots)) {
        assert.ok(isSorted(level), `out of order: ${level.join(", ")}`);
      }
    }
  });

  test("the order does not change between calls", async () => {
    const first = await getProjectTree();
    const second = await getProjectTree();

    assert.deepEqual(
      first.map((d) => [d.division.name, d.roots.map((r) => r.project.name)]),
      second.map((d) => [d.division.name, d.roots.map((r) => r.project.name)])
    );
  });
});

test("sub-project lists and both Gantt charts share due-date order without separating project work", async () => {
  const { getProjectBySlug } = await import("./projects.ts");
  const { getDivisionExtras } = await import("./deadlines.ts");
  const divisionId = mock.divisions()[0].id;
  await disk.mutate((store) => {
    const template = store.projects[0];
    const make = (
      id: string,
      name: string,
      targetDate: string | undefined,
      parentId: string | null = "sort-parent"
    ) => ({
      ...template,
      id,
      slug: id,
      name,
      targetDate,
      parentId,
      teamId: divisionId,
      startDate: "2026-07-01",
      phase: "concept" as const,
    });
    store.projects.push(
      make("sort-parent", "Parent", "2026-12-15", null),
      make("sort-late", "A late project", "2026-10-01"),
      make("sort-undated", "A undated project", undefined),
      make("sort-tie-b", "Beta tie", "2026-09-01"),
      make("sort-early", "Z earliest project", "2026-08-15"),
      make("sort-tie-a", "Alpha tie", "2026-09-01"),
      make("sort-grandchild", "Nested child", "2026-08-01", "sort-early")
    );
    const ownerId = store.members[0].id;
    store.deliverables.push(
      {
        id: "sort-d1",
        projectId: "sort-early",
        title: "First listed",
        ownerId,
        dueDate: "2026-08-14",
        status: "open",
        sortOrder: 0,
      },
      {
        id: "sort-d2",
        projectId: "sort-early",
        title: "Second listed",
        ownerId,
        dueDate: "2026-08-10",
        status: "open",
        sortOrder: 1,
      },
      {
        id: "sort-m1",
        projectId: "sort-early",
        title: "Checkpoint",
        kind: "milestone",
        dueDate: "2026-08-12",
        status: "open",
        sortOrder: 2,
      }
    );
    return { ok: true as const, value: null };
  });
  const before = JSON.stringify(disk.readStore());
  const detail = await getProjectBySlug("sort-parent", "m-anish");
  assert.ok(detail?.timeline);
  const siblings = [
    "sort-early",
    "sort-tie-a",
    "sort-tie-b",
    "sort-late",
    "sort-undated",
  ];
  assert.deepEqual(
    detail.children.map((n) => n.project.id),
    siblings
  );
  const expectedProjects = [
    "sort-parent",
    "sort-early",
    "sort-grandchild",
    ...siblings.slice(1),
  ];
  assert.deepEqual(
    detail.timeline.bars.filter((b) => b.kind === "project").map((b) => b.id),
    expectedProjects
  );
  assert.deepEqual(
    detail.timeline.bars.map((b) => b.id),
    [
      "sort-parent",
      "sort-early",
      "sort-d1",
      "sort-d2",
      "sort-m1",
      "sort-grandchild",
      ...siblings.slice(1),
    ]
  );
  const extras = (await getDivisionExtras())[divisionId];
  for (const rows of [extras.timelineRows, extras.timelineLiveRows]) {
    assert.deepEqual(
      rows?.filter((r) => r.id.startsWith("sort-")).map((r) => r.id),
      expectedProjects
    );
  }
  assert.equal(
    JSON.stringify(disk.readStore()),
    before,
    "ordering must never write dates, progress or row order to storage"
  );
});

/** Any seeded member. The roster order does not depend on who is looking. */
const VIEWER = "m-anish";

describe("the roster puts PLs first, then everyone alphabetically", () => {
  /*
    The order used to be whatever the store handed back, which for Postgres is
    not merely arbitrary but NOT STABLE — the same failure as the project tree
    above, and it fails just as silently. Two of the seeded projects had a
    plain member sitting above both of their PLs.

    The rank deliberately matches `projectREs`, because the PL list and this
    roster render on the same page and disagreeing about who comes first would
    read as a bug.
  */
  const rankOf = (
    row: { membership: { memberId: string; role: string } },
    primaryReId?: string
  ) =>
    row.membership.memberId === primaryReId
      ? 0
      : row.membership.role === "re"
        ? 1
        : 2;

  test("the primary PL is first, even when the store lists them third", async () => {
    // Seeded as: Anish Bayya (member), Lena Fischer [PL], Amara Okonkwo [PL].
    const view = await getProjectBySlug("gps-denied-navigation", VIEWER);
    assert.ok(view);
    assert.equal(view.members[0].member?.fullName, "Lena Fischer");
    assert.equal(view.members[0].membership.memberId, view.project.primaryReId);
  });

  test("other PLs come next, above every plain member", async () => {
    const view = await getProjectBySlug("gps-denied-navigation", VIEWER);
    assert.ok(view);
    assert.equal(view.members[1].member?.fullName, "Amara Okonkwo");
    assert.equal(view.members[1].membership.role, "re");
  });

  test("everyone else is alphabetical by full name", async () => {
    const view = await getProjectBySlug("wing-spar-redesign", VIEWER);
    assert.ok(view);
    const others = view.members
      .filter((r) => rankOf(r, view.project.primaryReId) === 2)
      .map((r) => r.member?.fullName ?? "");
    // Seeded Noah, Elena, Nadia — insertion order, not alphabetical.
    assert.deepEqual(others, [
      "Elena Petrova",
      "Nadia Haddad",
      "Noah Bergström",
    ]);
    assert.ok(isSorted(others));
  });

  /*
    Swept across every seeded project rather than asserting one list, because
    the bug this replaces was a MISSING sort: a single hand-written expectation
    passes just as happily against an accidental order that happens to match.
  */
  test("the rank never decreases, on any project", async () => {
    const slugs = disk.readStore().projects.map((x) => x.slug);
    let checked = 0;

    for (const slug of slugs) {
      const view = await getProjectBySlug(slug, VIEWER);
      if (!view || view.members.length < 2) continue;
      checked++;

      for (let i = 1; i < view.members.length; i++) {
        const a = view.members[i - 1];
        const b = view.members[i];
        const ra = rankOf(a, view.project.primaryReId);
        const rb = rankOf(b, view.project.primaryReId);
        assert.ok(ra <= rb, `${slug}: rank went ${ra} -> ${rb}`);
        if (ra === rb) {
          assert.ok(
            (a.member?.fullName ?? "").localeCompare(
              b.member?.fullName ?? ""
            ) <= 0,
            `${slug}: ${a.member?.fullName} before ${b.member?.fullName}`
          );
        }
      }
    }

    assert.ok(checked >= 8, `only ${checked} projects had a roster to check`);
  });

  test("exactly one row can hold rank 0", async () => {
    // Two "primary" rows would mean the badge on the page is lying about one
    // of them, and the sort would be picking arbitrarily between the pair.
    for (const slug of disk.readStore().projects.map((x) => x.slug)) {
      const view = await getProjectBySlug(slug, VIEWER);
      if (!view) continue;
      const primaries = view.members.filter(
        (r) => rankOf(r, view.project.primaryReId) === 0
      );
      assert.ok(primaries.length <= 1, `${slug} has ${primaries.length}`);
    }
  });
});
