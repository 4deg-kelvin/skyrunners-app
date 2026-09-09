/**
 * Dependencies — what may wait on what, and when that is a problem.
 *
 * Run with:  npm test
 *
 * Four rules carry the design, and each one is a decision that could plausibly
 * have gone the other way:
 *
 *   1. `project → deliverable` is not a legal shape.
 *   2. Targets are siblings and ancestors. Never descendants — the tree already
 *      says a parent cannot finish before its children.
 *   3. Cycles are refused.
 *   4. A conflict is "the thing you wait on lands after you do", and a finished
 *      target never conflicts however the dates read.
 *
 * Nothing here blocks work, so these are the rules behind a WARNING. That is
 * why the date check is allowed to be opinionated: being wrong costs a
 * misleading note, not a deadlocked sign-off.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  ancestorsOf,
  eligibleDeliverableTargets,
  eligibleProjectTargets,
  isLegalPair,
  resolveDependencies,
  wouldCycle,
  type Dependency,
} from "./dependencies.ts";
import type { Deliverable, Project } from "./types.ts";

/*
  A tree deliberately shaped to have every case in it:

    root-a                      (top level)
      child-a1
        grand-a1a
      child-a2
    root-b                      (top level, so a sibling of root-a)
*/
function project(id: string, parentId: string | null = null): Project {
  return {
    id,
    slug: id,
    name: id,
    teamId: "div",
    parentId,
    phase: "manufacturing",
    health: "on_track",
    reIds: [],
    primaryReId: "m-1",
    datesOverridden: false,
    isOpenToJoin: true,
    startDate: "2026-09-01",
    targetDate: "2026-12-01",
  };
}

const PROJECTS: Project[] = [
  project("root-a"),
  project("child-a1", "root-a"),
  project("grand-a1a", "child-a1"),
  project("child-a2", "root-a"),
  project("root-b"),
];

function deliverable(
  id: string,
  projectId: string,
  over: Partial<Deliverable> = {}
): Deliverable {
  return {
    id,
    projectId,
    title: id,
    ownerId: "m-1",
    status: "in_progress",
    sortOrder: 0,
    ...over,
  } as Deliverable;
}

describe("which shapes are legal", () => {
  test("a deliverable may wait on a deliverable or a project", () => {
    assert.equal(isLegalPair("deliverable", "deliverable"), true);
    assert.equal(isLegalPair("deliverable", "project"), true);
  });

  test("a project may wait on a project", () => {
    assert.equal(isLegalPair("project", "project"), true);
  });

  /*
    The one that is refused. A whole project waiting on one person's single task
    inverts the sizes: if a project genuinely hinges on one deliverable, either
    that deliverable belongs to the project, or the two projects depend on each
    other.
  */
  test("a project may NOT wait on a single deliverable", () => {
    assert.equal(isLegalPair("project", "deliverable"), false);
  });
});

describe("the ancestor chain", () => {
  const byId = new Map(PROJECTS.map((p) => [p.id, p]));

  test("walks all the way up, nearest first", () => {
    assert.deepEqual(
      ancestorsOf("grand-a1a", byId).map((p) => p.id),
      ["child-a1", "root-a"]
    );
  });

  test("a top-level project has none", () => {
    assert.deepEqual(ancestorsOf("root-a", byId), []);
  });

  test("a cycle terminates instead of hanging", () => {
    const looped = new Map(byId);
    looped.set("root-a", { ...project("root-a", "child-a1") });
    const chain = ancestorsOf("grand-a1a", looped).map((p) => p.id);
    assert.equal(new Set(chain).size, chain.length, "nothing visited twice");
  });
});

describe("which projects are offered", () => {
  test("siblings, for a nested project", () => {
    const ids = eligibleProjectTargets("child-a1", PROJECTS).map((p) => p.id);
    assert.ok(ids.includes("child-a2"), "its sibling");
    assert.ok(ids.includes("root-a"), "its parent");
  });

  /*
    The rule that keeps this from duplicating the tree. `updateProject` already
    refuses to complete a parent while a descendant is unfinished; a link there
    would be a hand-maintained second copy of that, and the two would disagree
    the moment one was edited.
  */
  test("never its own descendants", () => {
    const ids = eligibleProjectTargets("root-a", PROJECTS).map((p) => p.id);
    assert.equal(ids.includes("child-a1"), false);
    assert.equal(ids.includes("grand-a1a"), false);
    assert.equal(ids.includes("child-a2"), false);
  });

  test("never itself", () => {
    const ids = eligibleProjectTargets("child-a1", PROJECTS).map((p) => p.id);
    assert.equal(ids.includes("child-a1"), false);
  });

  /*
    Two top-level projects share a parent in the only sense the tree has —
    both have none — so they are siblings. Without this a top-level project
    could depend on nothing at all, which would make the feature useless for
    exactly the biggest projects.
  */
  test("two top-level projects are siblings", () => {
    const ids = eligibleProjectTargets("root-a", PROJECTS).map((p) => p.id);
    assert.deepEqual(ids, ["root-b"]);
  });

  test("a grandchild reaches its whole ancestor chain", () => {
    const ids = eligibleProjectTargets("grand-a1a", PROJECTS).map((p) => p.id);
    assert.ok(ids.includes("child-a1"), "parent");
    assert.ok(ids.includes("root-a"), "grandparent");
    assert.equal(ids.includes("root-b"), false, "but not an unrelated root");
  });
});

describe("which deliverables are offered", () => {
  const DELIVERABLES = [
    deliverable("d1", "child-a1"),
    deliverable("d2", "child-a1"),
    deliverable("d3", "child-a2"),
  ];

  test("the others on its own project", () => {
    const ids = eligibleDeliverableTargets("d1", "child-a1", DELIVERABLES).map(
      (d) => d.id
    );
    assert.deepEqual(ids, ["d2"]);
  });

  /*
    Same-project only. Reaching across a boundary is available through
    `deliverable → project` instead — wait on the project, not on one row inside
    it, because the other project's PL may split or rename their deliverables at
    any time.
  */
  test("never another project's", () => {
    const ids = eligibleDeliverableTargets("d1", "child-a1", DELIVERABLES).map(
      (d) => d.id
    );
    assert.equal(ids.includes("d3"), false);
  });

  test("never itself", () => {
    const ids = eligibleDeliverableTargets("d1", "child-a1", DELIVERABLES).map(
      (d) => d.id
    );
    assert.equal(ids.includes("d1"), false);
  });
});

describe("cycles are refused", () => {
  function dep(
    dependentKind: Dependency["dependentKind"],
    dependentId: string,
    targetKind: Dependency["targetKind"],
    targetId: string
  ): Dependency {
    return {
      id: `${dependentId}->${targetId}`,
      dependentKind,
      dependentId,
      targetKind,
      targetId,
      createdAt: "2026-09-08T00:00:00.000Z",
    };
  }

  test("A waiting on itself", () => {
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "a",
          targetKind: "project",
          targetId: "a",
        },
        []
      ),
      true
    );
  });

  test("A waits on B, so B cannot wait on A", () => {
    const existing = [dep("project", "a", "project", "b")];
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "b",
          targetKind: "project",
          targetId: "a",
        },
        existing
      ),
      true
    );
  });

  test("it follows a longer chain", () => {
    const existing = [
      dep("project", "a", "project", "b"),
      dep("project", "b", "project", "c"),
    ];
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "c",
          targetKind: "project",
          targetId: "a",
        },
        existing
      ),
      true
    );
  });

  test("and across kinds", () => {
    const existing = [dep("deliverable", "d1", "project", "p1")];
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "p1",
          targetKind: "project",
          targetId: "p1",
        },
        existing
      ),
      true
    );
  });

  test("a diamond is not a cycle", () => {
    // a -> b, a -> c, and now b -> d, c -> d. Legal: no path returns to itself.
    const existing = [
      dep("project", "a", "project", "b"),
      dep("project", "a", "project", "c"),
      dep("project", "b", "project", "d"),
    ];
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "c",
          targetKind: "project",
          targetId: "d",
        },
        existing
      ),
      false
    );
  });

  test("an id reused across kinds is a different node", () => {
    // A deliverable and a project could share an id in a fixture. They must not
    // collide, or a legal link would be refused as a cycle.
    const existing = [dep("deliverable", "x", "project", "y")];
    assert.equal(
      wouldCycle(
        {
          dependentKind: "project",
          dependentId: "y",
          targetKind: "project",
          targetId: "x",
        },
        existing
      ),
      false
    );
  });
});

describe("the date conflict", () => {
  const projects = [
    { ...project("p-late"), targetDate: "2026-12-20" },
    { ...project("p-early"), targetDate: "2026-10-01" },
    {
      ...project("p-done"),
      targetDate: "2026-12-20",
      phase: "complete" as const,
    },
    { ...project("p-undated"), targetDate: undefined },
  ] as Project[];

  const deliverables = [
    deliverable("mine", "child-a1", { dueDate: "2026-11-01" }),
  ];

  function link(targetId: string): Dependency {
    return {
      id: `l-${targetId}`,
      dependentKind: "deliverable",
      dependentId: "mine",
      targetKind: "project",
      targetId,
      createdAt: "2026-09-08T00:00:00.000Z",
    };
  }

  function resolve(targetIds: string[], ownDate?: string) {
    return resolveDependencies({
      dependencies: targetIds.map(link),
      ownKind: "deliverable",
      ownId: "mine",
      ownDate,
      projects,
      deliverables,
    });
  }

  test("fires when the thing you wait on lands after you are due", () => {
    const [r] = resolve(["p-late"], "2026-11-01");
    assert.ok(r.conflict, "p-late is due 2026-12-20, after 2026-11-01");
    assert.equal(r.conflict.days, 49);
  });

  test("silent when it lands before you", () => {
    const [r] = resolve(["p-early"], "2026-11-01");
    assert.equal(r.conflict, undefined);
  });

  /*
    Something already finished cannot make you late. Warning about it is how a
    panel becomes noise a PL learns to skip — and the dates on a completed
    project are history, not a promise.
  */
  test("a finished target never conflicts, whatever the dates say", () => {
    const [r] = resolve(["p-done"], "2026-11-01");
    assert.equal(r.targetDone, true);
    assert.equal(r.conflict, undefined);
  });

  /*
    Undated is not "fine". The warning claims a comparison, and with a date
    missing there is nothing to compare — so it says nothing rather than
    guessing.
  */
  test("no conflict claimed when either side is undated", () => {
    assert.equal(resolve(["p-undated"], "2026-11-01")[0].conflict, undefined);
    assert.equal(resolve(["p-late"], undefined)[0].conflict, undefined);
  });

  test("a target that no longer exists is dropped, not drawn broken", () => {
    assert.deepEqual(resolve(["p-deleted"], "2026-11-01"), []);
  });

  test("conflicts sort first, finished last", () => {
    const out = resolve(["p-done", "p-early", "p-late"], "2026-11-01");
    assert.deepEqual(
      out.map((r) => r.targetName),
      ["p-late", "p-early", "p-done"]
    );
  });

  test("it carries a link through to the target's page", () => {
    const [r] = resolve(["p-early"], "2026-11-01");
    assert.equal(r.targetHref, "/projects/p-early");
  });

  test("only this thing's own dependencies come back", () => {
    const out = resolveDependencies({
      dependencies: [
        link("p-early"),
        {
          id: "somebody-else",
          dependentKind: "deliverable",
          dependentId: "not-mine",
          targetKind: "project",
          targetId: "p-late",
          createdAt: "2026-09-08T00:00:00.000Z",
        },
      ],
      ownKind: "deliverable",
      ownId: "mine",
      ownDate: "2026-11-01",
      projects,
      deliverables,
    });
    assert.deepEqual(
      out.map((r) => r.targetName),
      ["p-early"]
    );
  });
});
