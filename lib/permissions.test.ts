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
    primaryReId: reIds[0] ?? "",
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
    // `manageTeams`, not the old `manageDivisions` — that was a second name for
    // this same rule, called by nothing but this test. A divison IS a team with
    // no parent, and the real UI has always gated on this one.
    assert.equal(can.manageTeams(actor("coLead")), true);
    assert.equal(can.manageTeams(actor("lead1")), false);
    assert.equal(can.manageTeams(actor("worker")), false);
  });
});

describe("effort visibility is restricted to the reporting chain", () => {
  test("you can always see your own", () => {
    assert.equal(can.viewMemberEffort(actor("worker"), graph, "worker"), true);
  });

  test("your lead chain can see it", () => {
    assert.equal(can.viewMemberEffort(actor("lead2"), graph, "worker"), true);
    assert.equal(can.viewMemberEffort(actor("coLead"), graph, "worker"), true);
  });

  test("an RE of a project you work on CANNOT see your whole record", () => {
    // Changed deliberately. An RE used to qualify via any shared project, which
    // meant being RE of one thing revealed a person's hours on everything else
    // plus their reliability record. The RE's narrower, legitimate question is
    // covered by viewMemberHoursOnProject below.
    assert.equal(
      can.viewMemberEffort(actor("reRoot"), graph, "worker"),
      false
    );
  });

  test("an unrelated member cannot", () => {
    assert.equal(
      can.viewMemberEffort(actor("outsider"), graph, "worker"),
      false
    );
  });
});

describe("an RE sees time on their own project only", () => {
  test("RE of the project can see hours logged on it", () => {
    assert.equal(
      can.viewMemberHoursOnProject(actor("reLeaf"), graph, "worker", "leaf"),
      true
    );
  });

  test("RE of a PARENT can too — authority inherits down the tree", () => {
    assert.equal(
      can.viewMemberHoursOnProject(actor("reRoot"), graph, "worker", "leaf"),
      true
    );
  });

  test("...but not on a project outside their subtree", () => {
    assert.equal(
      can.viewMemberHoursOnProject(actor("reOther"), graph, "worker", "leaf"),
      false
    );
  });

  test("the person themselves always can", () => {
    assert.equal(
      can.viewMemberHoursOnProject(actor("worker"), graph, "worker", "leaf"),
      true
    );
  });

  test("the lead chain can, on any project", () => {
    assert.equal(
      can.viewMemberHoursOnProject(actor("lead2"), graph, "worker", "other"),
      true
    );
  });
});

describe("update review is the Lead's job, and only theirs", () => {
  test("direct lead can review", () => {
    assert.equal(can.reviewUpdate(actor("lead2"), graph, "worker"), true);
  });

  test("a lead further up the chain can review", () => {
    assert.equal(can.reviewUpdate(actor("coLead"), graph, "worker"), true);
  });

  test("an RE CANNOT read someone's private report", () => {
    // Changed deliberately. Reviewing is the Lead's obligation and exactly one
    // person's, which is what makes the escalation in lib/review.ts mean
    // something. REs get the per-project half publicly instead.
    assert.equal(can.reviewUpdate(actor("reRoot"), graph, "worker"), false);
  });

  test("an unrelated member cannot", () => {
    assert.equal(can.reviewUpdate(actor("outsider"), graph, "worker"), false);
  });
});

describe("per-project update content is public", () => {
  test("anyone can read what's happening on a project", () => {
    // It belongs to the project, not the person: it's how someone finds work
    // and how a passing member spots a blocker they can clear.
    assert.equal(can.viewProjectUpdates(), true);
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

describe("membership is RE-controlled, with no cap", () => {
  const open = project("open", null, []);
  const closed = { ...project("closed", null, []), isOpenToJoin: false };

  test("anyone can follow anything — visibility is never gated", () => {
    assert.equal(can.followProject(), true);
  });

  test("a member can ask to join, but cannot add themselves", () => {
    assert.equal(can.requestToJoin(actor("worker"), open), true);
    assert.equal(can.addProjectMember(actor("worker"), graph, "leaf"), false);
  });

  test("the project's RE can add members", () => {
    assert.equal(can.addProjectMember(actor("reLeaf"), graph, "leaf"), true);
  });

  test("an ancestor RE can too, since authority inherits down", () => {
    assert.equal(can.addProjectMember(actor("reRoot"), graph, "leaf"), true);
  });

  test("an unrelated RE cannot", () => {
    assert.equal(can.addProjectMember(actor("reOther"), graph, "leaf"), false);
  });

  test("there is no commitment cap — REs staff as they see fit", () => {
    assert.ok(!("isAtCommitmentCap" in can));
    assert.ok(!("commitToProject" in can));
  });

  test("a closed project stops requests but not following", () => {
    assert.equal(can.requestToJoin(actor("worker"), closed), false);
    assert.equal(can.followProject(), true);
  });
});

describe("join requests keep the RE gate from becoming a dead end", () => {
  test("the RE reviews requests for their project", () => {
    assert.equal(can.reviewJoinRequest(actor("reLeaf"), graph, "leaf"), true);
  });

  test("an ancestor RE can also review", () => {
    assert.equal(can.reviewJoinRequest(actor("reRoot"), graph, "leaf"), true);
  });

  test("a co-lead can unblock a request an RE has ignored", () => {
    assert.equal(can.reviewJoinRequest(actor("coLead"), graph, "leaf"), true);
  });

  test("a random member cannot approve their own way in", () => {
    assert.equal(can.reviewJoinRequest(actor("worker"), graph, "leaf"), false);
  });

  test("a member can withdraw their own request, not someone else's", () => {
    assert.equal(can.withdrawJoinRequest(actor("worker"), "worker"), true);
    assert.equal(can.withdrawJoinRequest(actor("worker"), "outsider"), false);
  });
});

describe("deliverables", () => {
  test("an owner can update the status of their own deliverable", () => {
    assert.equal(
      can.updateDeliverableStatus(actor("worker"), graph, "leaf", "worker"),
      true
    );
  });

  test("an unrelated member cannot touch someone else's deliverable", () => {
    assert.equal(
      can.updateDeliverableStatus(actor("outsider"), graph, "leaf", "worker"),
      false
    );
  });

  test("an ancestor RE can, since they own the project subtree", () => {
    assert.equal(
      can.updateDeliverableStatus(actor("reRoot"), graph, "leaf", "worker"),
      true
    );
  });

  test("only REs and Co-Leads shape the list itself", () => {
    assert.equal(can.manageDeliverables(actor("reLeaf"), graph, "leaf"), true);
    assert.equal(can.manageDeliverables(actor("worker"), graph, "leaf"), false);
  });
});

describe("contribution visibility", () => {
  test("everyone can always see their own record", () => {
    assert.equal(can.viewOwnContribution(), true);
  });

  test("a Lead up the chain can see a member's record", () => {
    assert.equal(
      can.viewMemberContribution(actor("lead1"), graph, "worker"),
      true
    );
  });

  test("an unrelated member cannot", () => {
    assert.equal(
      can.viewMemberContribution(actor("outsider"), graph, "worker"),
      false
    );
  });

  test("an RE above a project the member works on CANNOT", () => {
    // Changed deliberately, alongside viewMemberEffort. Reliability and
    // commitment describe the person, so they belong to whoever supports that
    // person — their Lead. An RE sharing one project is not that.
    assert.equal(
      can.viewMemberContribution(actor("reRoot"), graph, "worker"),
      false
    );
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
