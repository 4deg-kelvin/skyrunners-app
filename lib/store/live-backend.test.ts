/**
 * The live backend must be resolved inside the request, not on a later tick.
 *
 * Run with:  npm test
 *
 * This pins a bug that shipped and was genuinely hard to see. `mutate()` defers
 * onto a module-level promise chain, and the live snapshot lives in React's
 * request-scoped `cache()`. Resolving the backend INSIDE the deferred callback
 * therefore ran outside the request scope, got nothing back, and silently wrote
 * to the local disk file instead of Postgres.
 *
 * The symptom was the worst kind: the save reported success, and the change was
 * gone on reload. No error, nothing in the logs.
 *
 * The resolver here mimics that scope by only returning a snapshot during the
 * current tick — exactly how `cache()` behaves once the request ends.
 */

import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SKYRUNNERS_STORE_DIR = mkdtempSync(join(tmpdir(), "sr-live-"));

const disk = await import("./disk.ts");

/** True only synchronously — a stand-in for a request-scoped cache. */
let inRequest = false;
let persisted: string[] = [];

beforeEach(() => {
  disk.resetStore();
  persisted = [];
  inRequest = true;

  disk.installLiveBackend(
    () => (inRequest ? liveSnapshot : null),
    async (mutated) => {
      persisted = mutated.members.map((m) => m.fullName);
    }
  );
});

const liveSnapshot = {
  version: 5,
  members: [
    {
      id: "live-1",
      fullName: "From Postgres",
      email: "live@stanford.edu",
      globalRole: "co_lead" as const,
      status: "active" as const,
      leadId: null,
      joinedAt: "2026-08-08",
    },
  ],
  projects: [],
  workLogs: [],
  deliverables: [],
  projectMemberships: [],
  joinRequests: [],
  progressUpdates: [],
  updateSchedules: [],
  teams: [],
  terms: [],
  events: [],
  projectArtifacts: [],
  projectNotices: [],
};

describe("mutate resolves the backend inside the request", () => {
  test("the live snapshot is used even though the write is deferred", async () => {
    // The request ends the moment control leaves this function — which is
    // exactly when the queued callback runs.
    const promise = disk.mutate((store) => {
      store.members[0].fullName = "Edited";
      return store.members.length;
    });
    inRequest = false; // request scope gone, callback hasn't run yet

    const count = await promise;

    assert.equal(count, 1, "should have mutated the live snapshot, not the seed");
    assert.deepEqual(
      persisted,
      ["Edited"],
      "the persister must receive the edit — if this is empty, the write went to disk and was lost"
    );
    assert.equal(liveSnapshot.members[0].fullName, "Edited");
  });

  test("the mutation does NOT touch the disk store", async () => {
    const before = disk.readStore().members.length;
    await disk.mutate((store) => store.members.push({ ...liveSnapshot.members[0], id: "x" }));
    inRequest = false;

    // readStore in demo mode reads the seed; it must be untouched.
    disk.installLiveBackend(() => null, async () => {});
    assert.equal(
      disk.readStore().members.length,
      before,
      "a live write leaked into the local disk store"
    );
  });
});
