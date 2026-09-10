import assert from "node:assert/strict";
import { before, beforeEach, after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGantt } from "../gantt.ts";
import { resolveDependencies } from "../dependencies.ts";

const dir = mkdtempSync(join(tmpdir(), "skyrunners-milestones-"));
process.env.SKYRUNNERS_STORE_DIR = dir;
let ops: typeof import("./operations.ts");
let disk: typeof import("./disk.ts");
let data: typeof import("../mock-data.ts");
before(async () => {
  ops = await import("./operations.ts");
  disk = await import("./disk.ts");
  data = await import("../mock-data.ts");
});
beforeEach(() => disk.resetStore());
after(() => rmSync(dir, { recursive: true, force: true }));
function home() {
  return disk
    .readStore()
    .projects.find((p) => p.phase !== "complete" && p.parentId === null)!;
}
async function milestone(title = "Design review") {
  const result = await ops.createDeliverable({
    projectId: home().id,
    kind: "milestone",
    title,
    dueDate: "2026-07-10",
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.value;
}
test("milestones never assign a member or alter anybody's personal delivered record", async () => {
  const beforeMembers = structuredClone(disk.readStore().projectMemberships);
  const beforeWork = disk
    .readStore()
    .members.map((m) => data.myDeliverables(m.id));
  const item = await milestone();
  assert.equal(item.ownerId, undefined);
  assert.equal(item.kind, "milestone");
  assert.deepEqual(disk.readStore().projectMemberships, beforeMembers);
  const progress = data.projectProgress(item.projectId);
  assert.ok(
    await ops
      .confirmDeliverable(item.id, "m-anish", "2026-07-10")
      .then((r) => r.ok)
  );
  assert.equal(data.projectProgress(item.projectId).done, progress.done + 1);
  assert.deepEqual(
    disk.readStore().members.map((m) => data.myDeliverables(m.id)),
    beforeWork
  );
});
test("ordinary deliverables still require an owner; milestones reject assignments on create and edit", async () => {
  assert.equal(
    (
      await ops.createDeliverable({
        projectId: home().id,
        title: "Needs an owner",
      })
    ).ok,
    false
  );
  assert.equal(
    (
      await ops.createDeliverable({
        projectId: home().id,
        title: "Checkpoint",
        kind: "milestone",
        ownerId: "m-anish",
      })
    ).ok,
    false
  );
  const item = await milestone();
  assert.equal(
    (
      await ops.updateDeliverable({
        deliverableId: item.id,
        title: "Changed",
        ownerId: "m-anish",
      })
    ).ok,
    false
  );
  assert.equal(
    disk.readStore().deliverables.find((d) => d.id === item.id)?.title,
    "Design review"
  );
  assert.equal(
    (await ops.submitDeliverable(item.id, "m-anish", "2026-07-10")).ok,
    false
  );
});
test("milestones can wait on deliverables and be awaited; links never shift dates", async () => {
  const checkpoint = await milestone();
  const other = await ops.createDeliverable({
    projectId: home().id,
    title: "Review package",
    ownerId: "m-anish",
    dueDate: "2026-07-12",
  });
  assert.ok(other.ok);
  const beforeDates = [checkpoint.dueDate, other.value.dueDate];
  const link = await ops.addDependency({
    dependentKind: "deliverable",
    dependentId: checkpoint.id,
    targetKind: "deliverable",
    targetId: other.value.id,
    actorId: "m-anish",
  });
  assert.ok(link.ok, link.ok ? "" : link.error);
  const store = disk.readStore();
  const resolved = resolveDependencies({
    dependencies: store.dependencies,
    ownKind: "deliverable",
    ownId: checkpoint.id,
    ownDate: checkpoint.dueDate,
    projects: store.projects,
    deliverables: store.deliverables,
  });
  assert.ok(resolved[0]?.conflict);
  assert.deepEqual(
    [
      store.deliverables.find((d) => d.id === checkpoint.id)?.dueDate,
      store.deliverables.find((d) => d.id === other.value.id)?.dueDate,
    ],
    beforeDates
  );
  const next = await milestone("Flight readiness");
  assert.ok(
    (
      await ops.addDependency({
        dependentKind: "deliverable",
        dependentId: next.id,
        targetKind: "deliverable",
        targetId: checkpoint.id,
        actorId: "m-anish",
      })
    ).ok
  );
  assert.equal(
    (
      await ops.addDependency({
        dependentKind: "deliverable",
        dependentId: checkpoint.id,
        targetKind: "deliverable",
        targetId: checkpoint.id,
        actorId: "m-anish",
      })
    ).ok,
    false
  );
});
test("milestone and deliverable dates have identical timeline geometry", () => {
  const row = {
    id: "m",
    name: "Review",
    end: "2026-07-10",
    depth: 1,
    tone: "neutral" as const,
  };
  const milestoneChart = buildGantt(
    [{ ...row, kind: "milestone" }],
    "2026-07-01"
  );
  const deliverableChart = buildGantt(
    [{ ...row, kind: "deliverable" }],
    "2026-07-01"
  );
  assert.deepEqual(milestoneChart, {
    ...deliverableChart,
    bars: deliverableChart.bars.map((b) => ({ ...b, kind: "milestone" })),
  });
});
import type { McpViewer } from "../mcp/viewer.ts";
test("MCP milestone tools use exact IDs, reject duplicate titles and enforce project authority", async () => {
  const { TOOLS } = await import("../mcp/tools.ts");
  const member = disk
    .readStore()
    .members.find((m) => m.globalRole === "co_lead")!;
  const viewer: McpViewer = {
    member,
    actor: { id: member.id, globalRole: member.globalRole },
    graph: {
      getMember: data.getMember,
      getProject: data.getProject,
      getTeam: data.getTeam,
      directREs: data.directREs,
    },
    scope: "write",
    tokenId: "test",
    tokenName: "test",
    client: null as unknown as McpViewer["client"],
  };
  const call = (name: string, args: Record<string, unknown>, who = viewer) =>
    TOOLS.find((t) => t.name === name)!.handler(args, who);
  await call("create_milestone", {
    project: home().id,
    title: "Review",
    due_date: "2026-07-10",
  });
  const first = disk
    .readStore()
    .deliverables.find((d) => d.kind === "milestone")!;
  await call("create_milestone", {
    project: home().id,
    title: "Review",
    due_date: "2026-07-11",
  });
  await assert.rejects(
    call("sign_off_deliverable", { project: home().id, title: "Review" }),
    /Several items/
  );
  await call("sign_off_deliverable", { project: home().id, title: first.id });
  assert.equal(
    disk.readStore().deliverables.find((d) => d.id === first.id)?.status,
    "done"
  );
  const next = await milestone("Ready");
  await call("add_waiting_on", {
    project: home().id,
    item: next.id,
    target_project: home().id,
    target_item: first.id,
  });
  assert.ok(
    disk
      .readStore()
      .dependencies.some(
        (d) => d.dependentId === next.id && d.targetId === first.id
      )
  );
  const outsider = disk
    .readStore()
    .members.find(
      (m) =>
        m.globalRole === "member" && !data.directREs(home().id).includes(m.id)
    )!;
  await assert.rejects(
    call(
      "create_milestone",
      { project: home().id, title: "Not allowed" },
      {
        ...viewer,
        member: outsider,
        actor: { id: outsider.id, globalRole: outsider.globalRole },
      }
    ),
    /leadership/
  );
});
