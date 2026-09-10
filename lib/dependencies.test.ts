/**
 * Dependencies — what may wait on what, and when that is a problem.
 *
 * Run with:  npm test
 *
 * Four rules carry the design, and each one is a decision that could plausibly
 * have gone the other way:
 *
 *   1. All four dependent/target shapes are legal. `project → deliverable` was
 *      refused for a day; `0056` dropped the CHECK.
 *   2. Scope is ONE TOP-LEVEL PROJECT'S TREE. A project may not wait on its own
 *      descendants — the tree already says a parent cannot finish before its
 *      children — but a deliverable may, because it contains nothing.
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
  descendantIdsOf,
  eligibleDeliverableTargets,
  eligibleProjectTargets,
  resolveDependencies,
  rootProjectIdOf,
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

describe("the top-level project a thing sits under", () => {
  test("a grandchild resolves to its root", () => {
    assert.equal(rootProjectIdOf("grand-a1a", PROJECTS), "root-a");
  });

  test("a top-level project is its own root", () => {
    assert.equal(rootProjectIdOf("root-b", PROJECTS), "root-b");
  });

  test("an unknown project has no root rather than a wrong one", () => {
    assert.equal(rootProjectIdOf("nope", PROJECTS), undefined);
  });

  /*
    `parent_id` is a plain column, so a loop is representable. It must terminate
    rather than hang the request — same reasoning as `projectChain` in
    `lib/permissions.ts`.
  */
  test("a cycle terminates instead of hanging", () => {
    const looped = [
      project("a", "b"),
      project("b", "c"),
      project("c", "a"),
      ...PROJECTS,
    ];
    assert.ok(rootProjectIdOf("a", looped));
  });
});

describe("descendants", () => {
  test("all the way down, not just children", () => {
    assert.deepEqual([...descendantIdsOf("root-a", PROJECTS)].sort(), [
      "child-a1",
      "child-a2",
      "grand-a1a",
    ]);
  });

  test("a leaf has none", () => {
    assert.deepEqual([...descendantIdsOf("grand-a1a", PROJECTS)], []);
  });

  test("never includes itself, even through a cycle", () => {
    const looped = [project("x"), project("y", "x"), project("x2", "y")];
    // Point the top back at the bottom to make a loop.
    looped[0] = project("x", "x2");
    assert.equal(descendantIdsOf("x", looped).has("x"), false);
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
  test("siblings and ancestors, for a nested project", () => {
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
    THE RULE THAT CHANGED, and the one this suite exists to pin down.

    Two top-level projects were treated as siblings, because they share a parent
    in the only sense the tree has — both have none. On the live club that made
    every unrelated project in the club an eligible dependency of every other:
    a deliverable on one course was offered the Zipline company visit and the
    sponsor pipeline as things it might be waiting for.

    The general lesson is in the module header. A scope rule phrased in tree
    terms has to be checked at BOTH ends of the tree, because "sibling" means
    something different at the root than it does in the middle.
  */
  test("NEVER another top-level project", () => {
    assert.deepEqual(eligibleProjectTargets("root-a", PROJECTS), []);
  });

  test("never anything in another top-level project's tree", () => {
    const ids = eligibleProjectTargets("grand-a1a", PROJECTS).map((p) => p.id);
    assert.ok(ids.includes("child-a1"), "parent");
    assert.ok(ids.includes("root-a"), "grandparent");
    assert.ok(ids.includes("child-a2"), "an uncle, still in the same tree");
    assert.equal(ids.includes("root-b"), false, "but not an unrelated root");
  });

  /*
    The asymmetry between the two kinds, which is the whole reason
    `dependentKind` is an argument. A deliverable is not a container of the
    sub-projects under its project, so no tree rule covers it — "I can't book
    the room until the floor-design sub-project lands" is a real sentence. What
    it may not wait on is its OWN project, which IS its container.
  */
  test("a deliverable's project scope is not its project's", () => {
    const forProject = eligibleProjectTargets(
      "child-a1",
      PROJECTS,
      "project"
    ).map((p) => p.id);
    const forDeliverable = eligibleProjectTargets(
      "child-a1",
      PROJECTS,
      "deliverable"
    ).map((p) => p.id);

    assert.equal(
      forProject.includes("grand-a1a"),
      false,
      "a project may not wait on its own child"
    );
    assert.ok(forDeliverable.includes("grand-a1a"), "a deliverable on it may");
    assert.equal(
      forDeliverable.includes("child-a1"),
      false,
      "but never on its own project"
    );
  });
});

describe("which deliverables are offered", () => {
  const DELIVERABLES = [
    deliverable("d1", "child-a1"),
    deliverable("d2", "child-a1"),
    deliverable("d3", "child-a2"),
    deliverable("d4", "grand-a1a"),
    deliverable("d5", "root-b"),
  ];

  const forDeliverable = (id: string, homeProjectId: string) =>
    eligibleDeliverableTargets({
      dependentKind: "deliverable",
      dependentId: id,
      homeProjectId,
      projects: PROJECTS,
      deliverables: DELIVERABLES,
    }).map((d) => d.id);

  const forProject = (homeProjectId: string) =>
    eligibleDeliverableTargets({
      dependentKind: "project",
      dependentId: homeProjectId,
      homeProjectId,
      projects: PROJECTS,
      deliverables: DELIVERABLES,
    }).map((d) => d.id);

  test("the others on its own project", () => {
    assert.ok(forDeliverable("d1", "child-a1").includes("d2"));
  });

  /*
    This USED to be refused, on the argument that reaching across a boundary
    should go through the project rather than one row inside it. It was wrong
    for a measurable reason: waiting on the whole project warns against the
    project's target date rather than the deliverable's, so the coarser link
    reads as landing later than the thing actually being waited for.
  */
  test("and the ones elsewhere in the same tree", () => {
    const ids = forDeliverable("d1", "child-a1");
    assert.ok(ids.includes("d3"), "an uncle project's");
    assert.ok(ids.includes("d4"), "a nephew project's");
  });

  test("never another top-level project's", () => {
    assert.equal(forDeliverable("d1", "child-a1").includes("d5"), false);
  });

  test("never itself", () => {
    assert.equal(forDeliverable("d1", "child-a1").includes("d1"), false);
  });

  /*
    `project → deliverable`, legal since `0056`. A project reaches deliverables
    elsewhere in its tree but never its own — those are its own work, and it is
    not finished until they are.
  */
  test("a project reaches other projects' deliverables, not its own", () => {
    const ids = forProject("child-a1");
    assert.equal(ids.includes("d1"), false, "its own");
    assert.equal(ids.includes("d2"), false, "its own");
    assert.ok(ids.includes("d3"), "a sibling project's");
    assert.equal(ids.includes("d4"), false, "not a descendant's");
    assert.equal(ids.includes("d5"), false, "not another tree's");
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

describe("the picker groups its own project's work first", () => {
  /*
    The dependency dropdown listed every eligible deliverable in one flat
    alphabetical run, so on a course with six sub-projects "Material selection
    and BOM" on THIS project sat between two same-named items on siblings, and
    the only way to tell them apart was the attribution suffix. The commonest
    case by far — waiting on something on your own project — was scattered
    through the list.
  */
  const PROJECTS = [
    project("root"),
    project("mine", "root"),
    project("zebra", "root"),
    project("apple", "root"),
  ];

  const DELIVERABLES = [
    deliverable("z-own", "mine", { title: "Z on my own project" }),
    deliverable("a-own", "mine", { title: "A on my own project" }),
    deliverable("a-zebra", "zebra", { title: "A on zebra" }),
    deliverable("a-apple", "apple", { title: "A on apple" }),
    deliverable("b-apple", "apple", { title: "B on apple" }),
  ];

  const ids = (dependentId: string, homeProjectId: string) =>
    eligibleDeliverableTargets({
      dependentKind: "deliverable",
      dependentId,
      homeProjectId,
      projects: PROJECTS,
      deliverables: DELIVERABLES,
    }).map((d) => d.id);

  test("own project's deliverables come first, alphabetically", () => {
    assert.deepEqual(ids("none", "mine").slice(0, 2), ["a-own", "z-own"]);
  });

  test("then the rest, grouped by project name", () => {
    // apple before zebra, and apple's two stay contiguous.
    assert.deepEqual(ids("none", "mine").slice(2), [
      "a-apple",
      "b-apple",
      "a-zebra",
    ]);
  });

  /*
    A PROJECT dependent has no own-project group at all — it may not wait on its
    own deliverables — so the whole list is the "elsewhere" group. The picker
    hides the empty heading rather than drawing a stray one.
  */
  test("a project dependent gets no own-project group", () => {
    const forProject = eligibleDeliverableTargets({
      dependentKind: "project",
      dependentId: "mine",
      homeProjectId: "mine",
      projects: PROJECTS,
      deliverables: DELIVERABLES,
    }).map((d) => d.id);
    assert.equal(forProject.includes("a-own"), false);
    assert.equal(forProject.includes("z-own"), false);
    assert.deepEqual(forProject, ["a-apple", "b-apple", "a-zebra"]);
  });
});
