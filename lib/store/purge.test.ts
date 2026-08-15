/**
 * The runaway-creation cap, and the cleanup for what a runaway leaves behind.
 *
 * Run with:  npm test
 *
 * ===========================================================================
 * Why this file is thorough out of proportion to its size
 * ===========================================================================
 *
 * It is the only code in the app that deletes rows in BULK, and it exists
 * because an assistant connected to the MCP server created ~4,000 empty
 * projects. So the thing under test is not really "does the delete work" — it is
 * **can this ever touch something somebody cared about**, and every assertion
 * below is a different way of asking that.
 *
 * The dangerous version of this feature matches on a name pattern or a time
 * window. This one matches on "nothing has ever happened here", so most of these
 * tests put ONE trace of work on an otherwise-identical project and check that it
 * survives.
 */

import assert from "node:assert/strict";
import { test, describe, before, beforeEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_DIR = mkdtempSync(join(tmpdir(), "skyrunners-purge-"));
process.env.SKYRUNNERS_STORE_DIR = TEST_DIR;

let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");

const TODAY = "2026-08-10";
/** The member whose assistant ran away. */
const CULPRIT = "m-tyler";
const OTHER = "m-priya";
const DIVISION = "t-airframe";

before(async () => {
  ops = await import("./operations.ts");
  disk = await import("./disk.ts");
});

beforeEach(() => {
  disk.resetStore();
});

process.on("exit", () => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});

/** One empty project, created the way the MCP server creates them. */
async function makeEmpty(name: string, createdBy = CULPRIT) {
  const result = await ops.createProject({
    name,
    parentId: null,
    teamId: DIVISION,
    primaryReId: createdBy,
    createdBy,
    today: TODAY,
  });
  assert.ok(result.ok, `setup failed: ${result.ok ? "" : result.error}`);
  return result.value;
}

const candidates = (creator = CULPRIT) =>
  ops.emptyProjectsCreatedBy(disk.readStore(), creator);

describe("the cap on runaway creation", () => {
  test(`refuses past ${25} empty projects in a day`, async () => {
    /*
      The incident in miniature. Nothing here is unauthorised — the same call
      succeeds twenty-five times and then stops, which is the point: the fix is a
      ceiling, not a permission change.
    */
    for (let i = 0; i < ops.MAX_EMPTY_PROJECTS_PER_DAY; i++) {
      const r = await makeEmpty(`Bulk ${i}`);
      assert.ok(r.id);
    }

    const over = await ops.createProject({
      name: "One too many",
      parentId: null,
      teamId: DIVISION,
      primaryReId: CULPRIT,
      createdBy: CULPRIT,
      today: TODAY,
    });
    assert.equal(over.ok, false);
    assert.match(over.ok ? "" : over.error, /no deliverables/);
  });

  test("a project with work on it doesn't count towards the cap", async () => {
    /*
      The reason the cap counts EMPTY projects rather than requests. Somebody
      actually working can file as many as they like, because each one they put a
      deliverable on stops being a shell.
    */
    for (let i = 0; i < ops.MAX_EMPTY_PROJECTS_PER_DAY + 5; i++) {
      const project = await makeEmpty(`Real ${i}`);
      const d = await ops.createDeliverable({
        projectId: project.id,
        title: `Task ${i}`,
        ownerId: CULPRIT,
      });
      assert.ok(d.ok, d.ok ? "" : d.error);
    }
    // Still allowed, well past the ceiling.
    const more = await makeEmpty("Another real one");
    assert.ok(more.id);
  });

  test("the ceiling is per person, so one runaway can't block everyone", async () => {
    for (let i = 0; i < ops.MAX_EMPTY_PROJECTS_PER_DAY; i++) {
      await makeEmpty(`Bulk ${i}`);
    }
    const theirs = await ops.createProject({
      name: "Somebody else's project",
      parentId: null,
      teamId: DIVISION,
      primaryReId: OTHER,
      createdBy: OTHER,
      today: TODAY,
    });
    assert.ok(theirs.ok, theirs.ok ? "" : theirs.error);
  });

  test("yesterday's projects don't hold today hostage", async () => {
    for (let i = 0; i < ops.MAX_EMPTY_PROJECTS_PER_DAY; i++) {
      await makeEmpty(`Bulk ${i}`);
    }
    // A new day, same untouched projects. The cap is a rate, not a total — a
    // total would permanently lock somebody out over old test projects.
    const tomorrow = await ops.createProject({
      name: "Fresh day",
      parentId: null,
      teamId: DIVISION,
      primaryReId: CULPRIT,
      createdBy: CULPRIT,
      today: "2026-08-11",
    });
    assert.ok(tomorrow.ok, tomorrow.ok ? "" : tomorrow.error);
  });
});

describe("what counts as an empty project", () => {
  test("a freshly created one with nothing on it does", async () => {
    const project = await makeEmpty("Project ABCX");
    assert.ok(candidates().some((c) => c.id === project.id));
  });

  test("it is attributed by creator, not by name", async () => {
    // The whole point. A bulk-looking name created by somebody else is not in
    // this creator's list, and a sensibly-named one of theirs is.
    const theirs = await makeEmpty("Project ABCX", OTHER);
    const mine = await makeEmpty("Perfectly Normal Project");
    const ids = candidates().map((c) => c.id);
    assert.ok(!ids.includes(theirs.id), "someone else's is out of scope");
    assert.ok(ids.includes(mine.id));
  });

  test("a deliverable saves it", async () => {
    const project = await makeEmpty("Has work");
    await ops.createDeliverable({
      projectId: project.id,
      title: "Something real",
      ownerId: CULPRIT,
    });
    assert.ok(!candidates().some((c) => c.id === project.id));
  });

  test("a work log entry saves it", async () => {
    const project = await makeEmpty("Logged against");
    const logged = await ops.logWork({
      memberId: CULPRIT,
      projectId: project.id,
      workDate: TODAY,
      description: "Spent an afternoon on this",
      today: TODAY,
    });
    assert.ok(logged.ok, logged.ok ? "" : logged.error);
    assert.ok(!candidates().some((c) => c.id === project.id));
  });

  test("a sub-project saves the parent", async () => {
    /*
      Independently important: `projects.parent_id` is `on delete restrict`, so
      deleting a parent out from under a child would fail at the database in live
      mode after appearing to succeed in demo.
    */
    const parent = await makeEmpty("Parent");
    const child = await ops.createProject({
      name: "Child",
      parentId: parent.id,
      teamId: DIVISION,
      primaryReId: CULPRIT,
      createdBy: CULPRIT,
      today: TODAY,
    });
    assert.ok(child.ok, child.ok ? "" : child.error);
    assert.ok(!candidates().some((c) => c.id === parent.id));
  });

  test("somebody else joining moves it to the SEPARATE group, not out of scope", async () => {
    /*
      This test used to assert that another member saved the project outright.
      Anish's real data disproved the reasoning: the bulk run added other members
      to some of its projects, so a hard veto left a pile of shells behind and he
      had to ask twice.

      Membership is not work — somebody standing in an empty room has not built
      anything. But it is not nothing either, and a genuine project in its first
      week looks identical from here. So it moves to `withOthers`, which the UI
      counts and offers on its own button, and is NOT in the default group.
    */
    const project = await makeEmpty("Somebody joined");
    const added = await ops.addProjectMember({
      projectId: project.id,
      memberId: OTHER,
      asRE: false,
      addedBy: OTHER,
      today: TODAY,
    });
    assert.ok(added.ok, added.ok ? "" : added.error);

    // Not in the safe group...
    assert.ok(!candidates().some((c) => c.id === project.id));
    // ...but reachable when the caller explicitly asks for the wider set.
    const wide = ops.emptyProjectsCreatedBy(disk.readStore(), CULPRIT, {
      withOthers: true,
    });
    assert.ok(wide.some((c) => c.id === project.id));

    // And the groups are reported apart, so the UI can never merge them.
    const groups = ops.emptyProjectsByCreator(disk.readStore());
    assert.ok(
      (groups.withOthers.get(CULPRIT) ?? []).some((c) => c.id === project.id)
    );
    assert.ok(
      !(groups.alone.get(CULPRIT) ?? []).some((c) => c.id === project.id)
    );
  });

  test("a member added by the CREATOR is still in the safe group", async () => {
    /*
      The distinction that makes the two groups useful. A bulk writer adding
      people to its own projects is still one actor acting alone — which is
      exactly what happened here — so it does not need the wider button.
    */
    const project = await makeEmpty("Bot added somebody");
    await ops.addProjectMember({
      projectId: project.id,
      memberId: OTHER,
      asRE: false,
      addedBy: CULPRIT,
      today: TODAY,
    });
    assert.ok(candidates().some((c) => c.id === project.id));
  });

  test("the wider set still refuses anything with real work on it", async () => {
    // The safety that must survive widening: `withOthers` relaxes WHO is on the
    // project, never WHETHER anything has happened on it.
    const project = await makeEmpty("Has members and work");
    await ops.addProjectMember({
      projectId: project.id,
      memberId: OTHER,
      asRE: false,
      addedBy: OTHER,
      today: TODAY,
    });
    await ops.createDeliverable({
      projectId: project.id,
      title: "Real work",
      ownerId: OTHER,
    });

    const wide = ops.emptyProjectsCreatedBy(disk.readStore(), CULPRIT, {
      withOthers: true,
    });
    assert.ok(!wide.some((c) => c.id === project.id));
  });

  test("none of the club's real seeded projects are ever candidates", async () => {
    /*
      The blunt end-to-end check. The seed is a realistic club, and if the
      emptiness test were loose in any way it would show up here as a real
      project being offered for deletion.
    */
    for (const member of disk.readStore().members) {
      for (const candidate of candidates(member.id)) {
        const store = disk.readStore();
        assert.ok(
          !store.deliverables.some((d) => d.projectId === candidate.id),
          `${candidate.name} has deliverables and was still offered`
        );
      }
    }
  });
});

describe("purging", () => {
  test("removes the shells and reports what is left", async () => {
    for (let i = 0; i < 5; i++) await makeEmpty(`Bulk ${i}`);
    const before = candidates().length;
    assert.equal(before, 5);

    const first = await ops.purgeEmptyProjectsCreatedBy({
      creatorId: CULPRIT,
      limit: 2,
    });
    assert.ok(first.ok, first.ok ? "" : first.error);
    assert.equal(first.value.deleted, 2);
    assert.equal(first.value.remaining, 3);

    const rest = await ops.purgeEmptyProjectsCreatedBy({
      creatorId: CULPRIT,
      limit: 250,
    });
    assert.ok(rest.ok, rest.ok ? "" : rest.error);
    assert.equal(rest.value.deleted, 3);
    assert.equal(rest.value.remaining, 0);
    assert.equal(candidates().length, 0);
  });

  test("the memberships go with the projects", async () => {
    // Left behind, they'd be rows pointing at a project that no longer exists —
    // and in live mode a foreign key would refuse the delete outright.
    const project = await makeEmpty("Bulk");
    await ops.purgeEmptyProjectsCreatedBy({ creatorId: CULPRIT, limit: 10 });
    const store = disk.readStore();
    assert.ok(!store.projects.some((p) => p.id === project.id));
    assert.ok(
      !store.projectMemberships.some((m) => m.projectId === project.id),
      "orphaned membership rows"
    );
  });

  test("it never touches a project with work on it", async () => {
    const shell = await makeEmpty("Shell");
    const real = await makeEmpty("Real");
    await ops.createDeliverable({
      projectId: real.id,
      title: "Actual work",
      ownerId: CULPRIT,
    });

    const result = await ops.purgeEmptyProjectsCreatedBy({
      creatorId: CULPRIT,
      limit: 250,
    });
    assert.ok(result.ok, result.ok ? "" : result.error);

    const store = disk.readStore();
    assert.ok(!store.projects.some((p) => p.id === shell.id), "shell went");
    assert.ok(
      store.projects.some((p) => p.id === real.id),
      "real one stayed"
    );
  });

  test("it never touches another member's projects", async () => {
    const theirs = await makeEmpty("Theirs", OTHER);
    await makeEmpty("Mine");

    await ops.purgeEmptyProjectsCreatedBy({ creatorId: CULPRIT, limit: 250 });
    assert.ok(disk.readStore().projects.some((p) => p.id === theirs.id));
  });

  test("an unknown creator deletes nothing at all", async () => {
    /*
      Guards the empty-string case specifically. If `creatorId` arrived blank
      from a form and the filter fell through, this would be a button that
      deletes every empty project in the club.
    */
    const before = disk.readStore().projects.length;
    for (const id of ["", "m-does-not-exist"]) {
      const result = await ops.purgeEmptyProjectsCreatedBy({
        creatorId: id,
        limit: 250,
      });
      assert.ok(result.ok, result.ok ? "" : result.error);
      assert.equal(result.value.deleted, 0);
    }
    assert.equal(disk.readStore().projects.length, before);
  });

  test("the seeded club survives a purge aimed at every member", async () => {
    // The 4,000-row incident with the safety on: run the purge for everybody and
    // confirm nothing with work on it disappeared.
    const before = disk.readStore();
    const withWork = before.projects
      .filter((p) => before.deliverables.some((d) => d.projectId === p.id))
      .map((p) => p.id);

    for (const member of before.members) {
      await ops.purgeEmptyProjectsCreatedBy({
        creatorId: member.id,
        limit: 500,
      });
    }

    const after = disk.readStore();
    for (const id of withWork) {
      assert.ok(
        after.projects.some((p) => p.id === id),
        `a project with deliverables was deleted: ${id}`
      );
    }
  });
});
