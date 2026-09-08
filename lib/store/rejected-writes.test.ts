import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKYRUNNERS_STORE_DIR = mkdtempSync(join(tmpdir(), "sr-rejected-"));
const disk = await import("./disk.ts");
const ops = await import("./operations.ts");

beforeEach(() => {
  disk.installLiveBackend(
    () => null,
    async () => {}
  );
  disk.resetStore();
});

test("a refused event edit changes neither memory nor disk", async () => {
  const original = structuredClone(disk.readStore().events[0]);
  assert.ok(original);
  const result = await ops.updateEvent({
    eventId: original.id,
    title: "This must not be saved",
    kind: original.kind,
    startsAt: original.startsAt,
    projectId: "missing-project",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(disk.readStore().events[0], original);
  disk.__resetCacheForTests();
  assert.deepEqual(disk.readStore().events[0], original);
});

test("a thrown mutation leaves the store intact and the queue usable", async () => {
  const original = structuredClone(disk.readStore().members[0]);
  await assert.rejects(
    disk.mutate((store) => {
      store.members[0].fullName = "Rejected";
      throw new Error("validation failed");
    }),
    /validation failed/
  );
  assert.deepEqual(disk.readStore().members[0], original);
  await disk.mutate((store) => {
    store.members[0].fullName = "Accepted";
  });
  disk.__resetCacheForTests();
  assert.equal(disk.readStore().members[0].fullName, "Accepted");
});

test("a refused live edit never calls the persister", async () => {
  const snapshot = structuredClone(disk.readStore());
  const original = structuredClone(snapshot.events[0]);
  let saves = 0;
  disk.installLiveBackend(
    () => snapshot,
    async () => {
      saves++;
    }
  );
  const result = await ops.updateEvent({
    eventId: original.id,
    title: "Rejected",
    kind: original.kind,
    startsAt: original.startsAt,
    projectId: "missing-project",
  });
  assert.equal(result.ok, false);
  assert.equal(saves, 0);
  assert.deepEqual(snapshot.events[0], original);
});

test("a failed live save does not leak the unsaved edit into the next write", async () => {
  const snapshot = structuredClone(disk.readStore());
  const original = structuredClone(snapshot.members[0]);
  disk.installLiveBackend(
    () => snapshot,
    async () => {
      throw new Error("offline");
    }
  );
  await assert.rejects(
    disk.mutate((store) => {
      store.members[0].fullName = "Unsaved";
    }),
    /offline/
  );
  assert.deepEqual(snapshot.members[0], original);
});
