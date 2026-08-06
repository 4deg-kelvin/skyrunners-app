/**
 * Tests for the permission module.
 *
 * Run with:  npm test
 *
 * The project-tree inheritance cases are written first on purpose — that's the
 * logic most likely to have a bug, and a bug there means someone can edit work
 * they shouldn't, or can't edit work they should.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  can,
  isCoLead,
  isLeadOfOrAbove,
  isREofOrAbove,
  leadChain,
  projectChain,
  type Actor,
  type OrgGraph,
} from "./permissions.ts";
import type { Member, Project } from "./types.ts";

// ---------------------------------------------------------------------------
// A small fixture world
//
//   Projects:  root ── mid ── leaf
//              other (separate tree)
//
//   People:    coLead
//              lead1  -> reports to coLead
//              lead2  -> reports to lead1
//              worker -> reports to lead2
//              outsider -> reports to coLead
// ---------------------------------------------------------------------------

function project(
  id: string,
  parentId: string | null,
  reIds: string[]
): Project {
  return {
    id,
    name: id,
    slug: id,
    parentId,
    reIds,
    phase: "concept",
    health: "on_track",
    datesOverridden: false,
    isOpenToJoin: true,
  };
}

function member(
  id: string,
  leadId: string | null,
  globalRole: Member["globalRole"] = "member"
): Member {
  return {
    id,
    fullName: id,
    email: `${id}@stanford.edu`,
    globalRole,
    status: "active",
    leadId,
    joinedAt: "2026-01-01",
  };
}

const projects: Project[] = [
  project("root", null, ["reRoot"]),
  project("mid", "root", ["reMid"]),
  project("leaf", "mid", ["reLeaf"]),
  project("other", null, ["reOther"]),
];

const members: Member[] = [
  member("coLead", null, "co_lead"),
  member("lead1", "coLead", "lead"),
  member("lead2", "lead1", "lead"),
  member("worker", "lead2"),
  member("outsider", "coLead"),
  member("reRoot", "coLead", "lead"),
  member("reMid", "coLead", "lead"),
  member("reLeaf", "coLead"),
  member("reOther", "coLead"),
];

const graph: OrgGraph = {
  getMember: (id) => members.find((m) => m.id === id),
  getProject: (id) => projects.find((p) => p.id === id),
  directREs: (id) => projects.find((p) => p.id === id)?.reIds ?? [],
};

const actor = (id: string): Actor => {
  const m = members.find((x) => x.id === id);
  return { id, globalRole: m?.globalRole ?? "member" };
};

// ---------------------------------------------------------------------------

describe("project tree traversal", () => {
  test("chain from leaf includes all ancestors, leaf first", () => {
    assert.deepEqual(projectChain(graph, "leaf"), ["leaf", "mid", "root"]);
  });

  test("chain from a root is just itself", () => {
    assert.deepEqual(projectChain(graph, "root"), ["root"]);
  });

  test("a cycle terminates instead of hanging", () => {
    const cyclic: OrgGraph = {
      ...graph,
      getProject: (id) =>
        id === "a"
          ? project("a", "b", [])
          : id === "b"
            ? project("b", "a", [])
            : undefined,
    };
    assert.deepEqual(projectChain(cyclic, "a"), ["a", "b"]);
  });
});

describe("RE authority inherits DOWN the project tree", () => {
  test("RE of root can act on a deeply nested descendant", () => {
    assert.equal(isREofOrAbove(actor("reRoot"), graph, "leaf"), true);
  });

  test("RE of mid can act on leaf", () => {
    assert.equal(isREofOrAbove(actor("reMid"), graph, "leaf"), true);
  });

  test("RE of leaf CANNOT act upward on its parent", () => {
    assert.equal(isREofOrAbove(actor("reLeaf"), graph, "mid"), false);
    assert.equal(isREofOrAbove(actor("reLeaf"), graph, "root"), false);
  });

  test("RE of a sibling tree has no authority here", () => {
    assert.equal(isREofOrAbove(actor("reOther"), graph, "leaf"), false);
  });

  test("a plain member has no RE authority", () => {
    assert.equal(isREofOrAbove(actor("worker"), graph, "leaf"), false);
  });
});

describe("Lead authority inherits UP the reporting chain", () => {
  test("chain from worker walks to the top", () => {
    assert.deepEqual(leadChain(graph, "worker"), ["lead2", "lead1", "coLead"]);
  });

  test("direct lead oversees the member", () => {
    assert.equal(isLeadOfOrAbove(actor("lead2"), graph, "worker"), true);
  });

  test("lead's lead also oversees the member", () => {
    assert.equal(isLeadOfOrAbove(actor("lead1"), graph, "worker"), true);
  });

  test("a peer does not oversee the member", () => {
    assert.equal(isLeadOfOrAbove(actor("outsider"), graph, "worker"), false);
  });

  test("nobody oversees themselves through the lead chain", () => {
    assert.equal(isLeadOfOrAbove(actor("worker"), graph, "worker"), false);
  });
});

describe("co-lead is unconditional", () => {
  test("isCoLead", () => {
    assert.equal(isCoLead(actor("coLead")), true);
    assert.equal(isCoLead(actor("lead1")), false);
  });

  test("co-lead can manage divisions, nobody else can", () => {
    assert.equal(can.manageDivisions(actor("coLead")), true);
    assert.equal(can.manageDivisions(actor("lead1")), false);
    assert.equal(can.manageDivisions(actor("worker")), false);
  });
});

describe("effort visibility is restricted", () => {
  test("you can always see your own", () => {
    assert.equal(can.viewMemberEffort(actor("worker"), graph, "worker"), true);
  });

  test("your lead chain can see it", () => {
    assert.equal(can.viewMemberEffort(actor("lead2"), graph, "worker"), true);
    assert.equal(can.viewMemberEffort(actor("coLead"), graph, "worker"), true);
  });

  test("an RE above a project you contribute to can see it", () => {
    assert.equal(
      can.viewMemberEffort(actor("reRoot"), graph, "worker", ["leaf"]),
      true
    );
  });

  test("an unrelated member cannot", () => {
    assert.equal(
      can.viewMemberEffort(actor("outsider"), graph, "worker", ["leaf"]),
      false
    );
  });
});

describe("update review", () => {
  test("RE of an ancestor of a referenced project can review", () => {
    assert.equal(
      can.reviewUpdate(actor("reRoot"), graph, "worker", ["leaf"]),
      true
    );
  });

  test("unrelated RE cannot review", () => {
    assert.equal(
      can.reviewUpdate(actor("reOther"), graph, "worker", ["leaf"]),
      false
    );
  });

  test("direct lead can review regardless of projects", () => {
    assert.equal(can.reviewUpdate(actor("lead2"), graph, "worker", []), true);
  });
});

describe("training verification", () => {
  test("member requests their own, cannot verify it", () => {
    assert.equal(can.requestTraining(actor("worker"), "worker"), true);
    assert.equal(can.verifyTraining(actor("worker"), graph, "worker"), false);
  });

  test("direct lead verifies", () => {
    assert.equal(can.verifyTraining(actor("lead2"), graph, "worker"), true);
  });

  test("co-lead verifies", () => {
    assert.equal(can.verifyTraining(actor("coLead"), graph, "worker"), true);
  });

  test("unrelated lead does not", () => {
    assert.equal(can.verifyTraining(actor("outsider"), graph, "worker"), false);
  });
});

describe("self-enrollment is open by default", () => {
  test("any member can join an open project", () => {
    const open = project("open", null, []);
    assert.equal(can.joinProject(actor("worker"), open), true);
  });

  test("a closed project blocks self-enrollment", () => {
    const closed = { ...project("closed", null, []), isOpenToJoin: false };
    assert.equal(can.joinProject(actor("worker"), closed), false);
  });
});

describe("project creation is deliberately easy for leadership", () => {
  test("any lead can create a top-level project", () => {
    assert.equal(can.createProject(actor("lead1"), graph), true);
  });

  test("a plain member cannot", () => {
    assert.equal(can.createProject(actor("worker"), graph), false);
  });

  test("an RE can create a sub-project under something they own", () => {
    assert.equal(can.createProject(actor("reLeaf"), graph, "leaf"), true);
  });

  test("an RE cannot create a sub-project under someone else's tree", () => {
    assert.equal(can.createProject(actor("reLeaf"), graph, "other"), false);
  });
});
