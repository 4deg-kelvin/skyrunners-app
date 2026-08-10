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
import type { Member, Project, Team } from "./types.ts";

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
  reIds: string[],
  teamId?: string
): Project {
  return {
    id,
    name: id,
    slug: id,
    parentId,
    teamId,
    primaryReId: reIds[0] ?? "",
    reIds,
    phase: "concept",
    health: "on_track",
    datesOverridden: false,
    isOpenToJoin: true,
  };
}

function team(id: string, parentId: string | null, leadId?: string): Team {
  return { id, name: id, slug: id, parentId, leadId, isActive: true };
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
  project("root", null, ["reRoot"], "divA"),
  project("mid", "root", ["reMid"]),
  project("leaf", "mid", ["reLeaf"]),
  project("other", null, ["reOther"], "divB"),

  /*
    A deliberately DEEP branch, five levels, with an RE only at the top.

    The main tree is three deep, which is enough to prove inheritance happens
    and not enough to prove it doesn't stop. "Is an RE four projects down still
    covered?" is a real question about a real club structure, so it gets a real
    fixture rather than an argument from reading `projectChain`.
  */
  project("d1", null, ["reD1"], "subA"),
  project("d2", "d1", []),
  project("d3", "d2", []),
  project("d4", "d3", []),
  project("d5", "d4", ["reD5"]),
];

/*
  Org tree, separate from the project tree:

    divA (divLead)          owns `root` and everything under it
      └ subA (subLead)      owns `d1` and everything under it
    divB (otherDivLead)     owns `other`
*/
const teams: Team[] = [
  team("divA", null, "divLead"),
  team("subA", "divA", "subLead"),
  team("divB", null, "otherDivLead"),
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
  member("reD1", "coLead"),
  member("reD5", "coLead"),
  member("divLead", "coLead", "lead"),
  member("subLead", "divLead", "lead"),
  member("otherDivLead", "coLead", "lead"),
];

const graph: OrgGraph = {
  getMember: (id) => members.find((m) => m.id === id),
  getProject: (id) => projects.find((p) => p.id === id),
  directREs: (id) => projects.find((p) => p.id === id)?.reIds ?? [],
  getTeam: (id) => teams.find((t) => t.id === id),
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

  // -------------------------------------------------------------------------
  // Depth. There is no limit, and these say so at a depth nobody would reach
  // by accident — d1 → d2 → d3 → d4 → d5, with the RE only at the top.
  // -------------------------------------------------------------------------

  test("an RE four levels up still owns the bottom of the tree", () => {
    assert.deepEqual(projectChain(graph, "d5"), ["d5", "d4", "d3", "d2", "d1"]);
    assert.equal(isREofOrAbove(actor("reD1"), graph, "d5"), true);
  });

  test("every level in between is covered too", () => {
    for (const id of ["d2", "d3", "d4", "d5"]) {
      assert.equal(isREofOrAbove(actor("reD1"), graph, id), true, id);
    }
  });

  test("and it still doesn't leak upward from the bottom", () => {
    // Four levels of inheritance downward must not become one upward.
    for (const id of ["d1", "d2", "d3", "d4"]) {
      assert.equal(isREofOrAbove(actor("reD5"), graph, id), false, id);
    }
    assert.equal(isREofOrAbove(actor("reD5"), graph, "d5"), true);
  });

  test("an RE deep in one tree has nothing in another", () => {
    assert.equal(isREofOrAbove(actor("reD5"), graph, "leaf"), false);
    assert.equal(isREofOrAbove(actor("reD1"), graph, "other"), false);
  });
});

describe("a Division Lead is a top RE over their division", () => {
  test("they have RE authority on a project their division owns", () => {
    // divLead is not an RE of anything. Before this rule they owned the
    // division on the org chart and could do nothing inside it.
    assert.equal(isREofOrAbove(actor("divLead"), graph, "root"), true);
  });

  test("it reaches sub-projects that carry no team of their own", () => {
    // `mid` and `leaf` have no teamId — sub-projects inherit their parent's
    // team in practice, and the walk goes up the PROJECT tree to find it.
    assert.equal(isREofOrAbove(actor("divLead"), graph, "mid"), true);
    assert.equal(isREofOrAbove(actor("divLead"), graph, "leaf"), true);
  });

  test("and all the way down a five-deep tree under a sub-team", () => {
    assert.equal(isREofOrAbove(actor("divLead"), graph, "d5"), true);
  });

  test("a sub-team lead covers their own team's work", () => {
    assert.equal(isREofOrAbove(actor("subLead"), graph, "d1"), true);
    assert.equal(isREofOrAbove(actor("subLead"), graph, "d5"), true);
  });

  test("but a sub-team lead does NOT reach the rest of the division", () => {
    // subA sits under divA; authority flows down, never sideways or up.
    assert.equal(isREofOrAbove(actor("subLead"), graph, "root"), false);
    assert.equal(isREofOrAbove(actor("subLead"), graph, "leaf"), false);
  });

  test("leading one division grants nothing in another", () => {
    assert.equal(isREofOrAbove(actor("otherDivLead"), graph, "root"), false);
    assert.equal(isREofOrAbove(actor("divLead"), graph, "other"), false);
  });

  test("the real powers follow, not just the predicate", () => {
    // The point of putting this in `isREofOrAbove` rather than in each rule:
    // every project permission inherits it at once.
    assert.equal(can.manageDeliverables(actor("divLead"), graph, "leaf"), true);
    assert.equal(can.assignRE(actor("divLead"), graph, "leaf"), true);
    assert.equal(can.reviewJoinRequest(actor("divLead"), graph, "leaf"), true);
    assert.equal(can.manageProject(actor("divLead"), graph, "leaf"), true);

    // …and the same list stays shut for a lead from elsewhere.
    assert.equal(
      can.manageDeliverables(actor("otherDivLead"), graph, "leaf"),
      false
    );
    assert.equal(can.assignRE(actor("otherDivLead"), graph, "leaf"), false);
  });

  test("a division lead still cannot read a personal report", () => {
    /*
      "Top RE" means top RE, not Co-Lead. The private half of a check-in is the
      Lead chain's, and an RE deliberately can't read it — that's what keeps
      reviewing one named person's obligation. `worker` reports to lead2, not
      to divLead, so the answer has to stay no.
    */
    assert.equal(
      can.viewMemberEffort(actor("divLead"), graph, "worker"),
      false
    );
    assert.equal(can.reviewUpdate(actor("divLead"), graph, "worker"), false);
  });

  test("a team with no lead grants nobody anything", () => {
    const leaderless: OrgGraph = {
      ...graph,
      getTeam: (id) => (id === "divA" ? team("divA", null) : undefined),
    };
    assert.equal(isREofOrAbove(actor("divLead"), leaderless, "root"), false);
  });

  test("a cycle in the org tree terminates instead of hanging", () => {
    // `teams.parent_id` has no constraint against this, same as projects.
    const cyclic: OrgGraph = {
      ...graph,
      getTeam: (id) =>
        id === "divA"
          ? team("divA", "subA")
          : id === "subA"
            ? team("subA", "divA")
            : undefined,
    };
    assert.equal(isREofOrAbove(actor("divLead"), cyclic, "root"), false);
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
    assert.equal(can.viewMemberEffort(actor("reRoot"), graph, "worker"), false);
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
  test("anyone can follow anything — visibility is never gated", () => {
    assert.equal(can.followProject(), true);
  });

  /*
    `requestToJoin` takes no arguments on purpose, which is why the open/closed
    project fixtures that used to sit here are gone. "Not looking for anyone
    new" is a signal to read before asking, not a lock on the ask — a project
    that has stopped recruiting still has to be askable, or the flag quietly
    recreates the dead end `join_requests` exists to remove.
  */
  test("a member can ask to join, but cannot add themselves", () => {
    assert.equal(can.requestToJoin(), true);
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

  test("'not recruiting' is a signal, not a lock", () => {
    /*
      This used to assert the opposite — a closed project refused requests.
      That turned "we're not looking right now" into "you may not even ask",
      and hid the one button that gets somebody onto a project. A member who
      can't ask has no route in except knowing somebody, which is the problem
      the app exists to remove. The RE still decides.
    */
    assert.equal(can.requestToJoin(), true);
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

  /*
    The checklist is the one place the OWNER gets a right their RE-only
    neighbours don't. Safe because a todo counts towards nothing — the only
    thing it can do is hold up a sign-off, and the RE can clear it themselves.
  */
  test("the owner keeps their own checklist, even though they can't shape the list", () => {
    assert.equal(
      can.manageDeliverables(actor("worker"), graph, "leaf"),
      false,
      "precondition: the owner is not an RE here"
    );
    assert.equal(
      can.manageDeliverableTodos(actor("worker"), graph, "leaf", "worker"),
      true
    );
  });

  test("an RE of the project can too", () => {
    assert.equal(
      can.manageDeliverableTodos(actor("reLeaf"), graph, "leaf", "worker"),
      true
    );
  });

  test("and an RE above it, since authority inherits down the tree", () => {
    assert.equal(
      can.manageDeliverableTodos(actor("reRoot"), graph, "leaf", "worker"),
      true
    );
  });

  test("a passer-by cannot — owning nothing here grants nothing", () => {
    // The rule reads `ownerId` as the DELIVERABLE's owner, which is why the
    // action layer takes it from the stored row rather than the form. Claiming
    // to be the owner has to buy nothing, or the wider rule becomes a hole.
    assert.equal(
      can.manageDeliverableTodos(actor("outsider"), graph, "leaf", "worker"),
      false
    );
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

describe("project creation is easy for leadership, but scoped to their division", () => {
  test("a Co-Lead can create anywhere", () => {
    assert.equal(
      can.createProject(actor("coLead"), graph, { teamId: "divA" }),
      true
    );
    assert.equal(
      can.createProject(actor("coLead"), graph, { teamId: "divB" }),
      true
    );
  });

  test("a Division Lead can create in their own division", () => {
    assert.equal(
      can.createProject(actor("divLead"), graph, { teamId: "divA" }),
      true
    );
  });

  test("…and in a sub-team beneath it", () => {
    // subA sits under divA, so authority reaches down the org tree.
    assert.equal(
      can.createProject(actor("divLead"), graph, { teamId: "subA" }),
      true
    );
  });

  test("but NOT in somebody else's division", () => {
    /*
      The rule this replaced was a bare `globalRole === "lead"` check — the only
      unscoped rule in the file. It let a sub-team lead in one division start
      top-level work in another, which is the silo problem wearing a different
      hat: work appearing in a division whose lead didn't know about it.
    */
    assert.equal(
      can.createProject(actor("divLead"), graph, { teamId: "divB" }),
      false
    );
  });

  test("a sub-team lead is scoped to their own team, not the division above", () => {
    assert.equal(
      can.createProject(actor("subLead"), graph, { teamId: "subA" }),
      true
    );
    assert.equal(
      can.createProject(actor("subLead"), graph, { teamId: "divA" }),
      false
    );
  });

  test("a plain member cannot", () => {
    assert.equal(
      can.createProject(actor("worker"), graph, { teamId: "divA" }),
      false
    );
  });

  test("an RE can create a sub-project under something they own", () => {
    assert.equal(
      can.createProject(actor("reLeaf"), graph, { parentProjectId: "leaf" }),
      true
    );
  });

  test("an RE cannot create a sub-project under someone else's tree", () => {
    assert.equal(
      can.createProject(actor("reLeaf"), graph, { parentProjectId: "other" }),
      false
    );
  });

  test("no target at all is false, including for a Lead", () => {
    // The page asks "is there a division you could pick" instead — `OrgGraph`
    // looks teams up by id and can't enumerate them.
    assert.equal(can.createProject(actor("lead1"), graph), false);
    assert.equal(can.createProject(actor("divLead"), graph), false);
  });
});

// ---------------------------------------------------------------------------
// Approving is not the same right as doing
// ---------------------------------------------------------------------------

describe("only somebody above a project can approve it", () => {
  /*
    Fixture recap, since these tests turn entirely on it:

      root (reRoot)   owned by team divA, led by divLead
        └ mid (reMid)
            └ leaf (reLeaf)

    `mid` and `leaf` carry no teamId, so they inherit divA through the project
    tree — which is exactly the case a naive implementation drops.
  */

  test("the project's own RE cannot mark it complete", () => {
    // The whole point. reMid runs `mid` and can edit everything about it…
    assert.equal(can.manageProject(actor("reMid"), graph, "mid"), true);
    // …but declaring their own work finished is somebody else's job.
    assert.equal(can.completeProject(actor("reMid"), graph, "mid"), false);
  });

  test("the RE one level up can", () => {
    assert.equal(can.completeProject(actor("reRoot"), graph, "mid"), true);
  });

  test("an RE four levels up can, at any depth", () => {
    assert.equal(can.completeProject(actor("reD1"), graph, "d5"), true);
  });

  test("the Division Lead can, including on projects with no teamId", () => {
    // `leaf` has no team of its own — it inherits divA up the project tree.
    assert.equal(can.completeProject(actor("divLead"), graph, "leaf"), true);
    assert.equal(can.completeProject(actor("divLead"), graph, "root"), true);
  });

  test("a Division Lead who is ALSO the project's RE is still excluded", () => {
    /*
      Wearing both hats doesn't create a reviewer. The app can't fix an org
      that assigns a project to the person who approves it — but it can decline
      to pretend a review happened, and escalate to whoever is above them.
    */
    const selfAssigned: Project[] = projects.map((p) =>
      p.id === "root" ? { ...p, reIds: ["divLead"], primaryReId: "divLead" } : p
    );
    const g: OrgGraph = {
      ...graph,
      getProject: (id) => selfAssigned.find((p) => p.id === id),
      directREs: (id) => selfAssigned.find((p) => p.id === id)?.reIds ?? [],
    };

    assert.equal(can.manageProject(actor("divLead"), g, "root"), true);
    assert.equal(can.completeProject(actor("divLead"), g, "root"), false);
  });

  test("a Co-Lead always can — that's the escape hatch", () => {
    // Without it, a Co-Lead who is the RE of a top-level project could never
    // complete it, and it would be stuck forever.
    const selfAssigned: Project[] = projects.map((p) =>
      p.id === "root" ? { ...p, reIds: ["coLead"], primaryReId: "coLead" } : p
    );
    const g: OrgGraph = {
      ...graph,
      getProject: (id) => selfAssigned.find((p) => p.id === id),
      directREs: (id) => selfAssigned.find((p) => p.id === id)?.reIds ?? [],
    };

    assert.equal(can.completeProject(actor("coLead"), g, "root"), true);
  });

  test("a sub-team lead covers their own subtree and nothing sideways", () => {
    assert.equal(can.completeProject(actor("subLead"), graph, "d5"), true);
    assert.equal(can.completeProject(actor("subLead"), graph, "mid"), false);
  });

  test("an RE of a sibling tree cannot", () => {
    assert.equal(can.completeProject(actor("reOther"), graph, "mid"), false);
  });

  test("a plain member cannot", () => {
    assert.equal(can.completeProject(actor("worker"), graph, "leaf"), false);
  });

  test("a Lead with no project authority cannot", () => {
    // Being somebody's Lead is the reporting chain, not the project tree.
    assert.equal(can.completeProject(actor("lead2"), graph, "leaf"), false);
  });
});

describe("withdrawing a sign-off needs the same authority", () => {
  test("signing off stays with the project's own RE", () => {
    // Unchanged, and deliberately so — that's the job the deliverable model
    // costs them five minutes a week for.
    assert.equal(can.manageDeliverables(actor("reMid"), graph, "mid"), true);
  });

  test("but that RE cannot overturn a sign-off on their own project", () => {
    assert.equal(can.withdrawSignOff(actor("reMid"), graph, "mid"), false);
  });

  test("the RE above can", () => {
    assert.equal(can.withdrawSignOff(actor("reRoot"), graph, "mid"), true);
  });

  test("so can the Division Lead and a Co-Lead", () => {
    assert.equal(can.withdrawSignOff(actor("divLead"), graph, "leaf"), true);
    assert.equal(can.withdrawSignOff(actor("coLead"), graph, "leaf"), true);
  });

  test("the deliverable's owner cannot, even on their own work", () => {
    assert.equal(can.withdrawSignOff(actor("worker"), graph, "leaf"), false);
  });
});

describe("closing an event off is narrower than creating one", () => {
  test("a Co-Lead can make an invite-only event", () => {
    assert.equal(can.createClosedEvent(actor("coLead")), true);
  });

  test("a Lead cannot, even though they can create club-wide events", () => {
    /*
      An open calendar is the point of the feature — /find-work and the
      calendar exist so a member can plug into the club's work without asking
      permission, and every closed event subtracts from that. The cases that
      need one (a sponsor visit with a headcount, an interview panel) are
      things a Co-Lead is arranging anyway.
    */
    assert.equal(can.createEvent(actor("lead1")), true);
    assert.equal(can.createClosedEvent(actor("lead1")), false);
  });

  test("a member cannot", () => {
    assert.equal(can.createClosedEvent(actor("worker")), false);
  });

  test("the organiser owns the guest list, whoever they are", () => {
    // The only route by which a closed event's list can ever change —
    // `setEventAttendance` refuses those by design.
    assert.equal(can.manageEventGuestList(actor("worker"), "worker"), true);
    assert.equal(can.manageEventGuestList(actor("worker"), "lead1"), false);
  });

  test("a Co-Lead can fix anybody's list", () => {
    assert.equal(can.manageEventGuestList(actor("coLead"), "worker"), true);
  });

  test("a Lead cannot take over somebody else's guest list", () => {
    // Deliberately tighter than `manageEvent`, which lets any leadership
    // cancel a stale event. Rewriting who is invited to somebody else's
    // meeting is a different act from tidying the calendar.
    assert.equal(can.manageEvent(actor("lead1"), "worker"), true);
    assert.equal(can.manageEventGuestList(actor("lead1"), "worker"), false);
  });
});
