/**
 * An edit must go out as an UPDATE, never as an upsert.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * The bug this pins
 * ---------------------------------------------------------------------------
 *
 * `persistDiff` used to `upsert()` everything the diff touched. An upsert is
 * `INSERT ... ON CONFLICT DO UPDATE`, so Postgres evaluates the table's INSERT
 * policy `WITH CHECK` even when the row already exists and nothing is inserted.
 *
 * That made every `for update` policy in the schema unreachable. A Lead
 * pressing "Mark as read" hit:
 *
 *     new row violates row-level security policy for table "progress_updates"
 *
 * — because the only INSERT policy on that table says you may only file a
 * check-in under your own `member_id`, which is exactly the rule that must NOT
 * be loosened. `update_entries_respond_re` was broken the same way and hadn't
 * been clicked yet.
 *
 * These tests use a fake client that records the VERB, because the verb is the
 * whole bug. Asserting on the resulting data would pass either way.
 */

import assert from "node:assert/strict";
import { test, describe, beforeEach } from "node:test";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "@supabase/supabase-js";

import { persistDiff } from "./supabase.ts";
import { COLLECTIONS } from "./mapping.ts";
import type { StoreShape } from "./disk.ts";

interface Call {
  verb: "upsert" | "update" | "delete";
  table: string;
  rows: number;
}

let calls: Call[] = [];

/**
 * Enough of the PostgREST builder to record what was asked for.
 *
 * `.eq()` chains and `.select()` resolves — matching the real shapes
 * `persistDiff` uses. Every statement reports one affected row, so the
 * zero-rows-means-RLS guard stays quiet.
 */
function fakeClient(): SupabaseClient {
  const builder = (verb: Call["verb"], table: string, rows: number) => {
    calls.push({ verb, table, rows });
    const chain = {
      eq: () => chain,
      in: () => chain,
      select: async () => ({ data: [{ id: "x" }], error: null }),
      // Awaiting the builder directly, as the delete-by-`in` path does.
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: [{ id: "x" }], error: null }),
    };
    return chain;
  };

  return {
    from: (table: string) => ({
      upsert: (rows: unknown[]) =>
        builder("upsert", table, Array.isArray(rows) ? rows.length : 1),
      update: (row: unknown) => builder("update", table, row ? 1 : 0),
      delete: () => builder("delete", table, 1),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * The smallest store that satisfies the shape, with one check-in in it.
 *
 * Every collection is derived from `COLLECTIONS` rather than hand-listed, so
 * adding a table to the app can't quietly make this fixture wrong — a missing
 * key throws inside `persistDiff` rather than skipping the check.
 */
function storeWith(reviewedAt?: string): StoreShape {
  const empty: Record<string, unknown[]> = {};
  for (const spec of COLLECTIONS) empty[spec.key] = [];

  const base = {
    version: 1,
    ...empty,
    helpRequests: [],
    progressUpdates: [
      {
        id: "u-1",
        memberId: "m-kevin",
        dueDate: "2026-08-09",
        submittedAt: "2026-08-09",
        leadIdAtSubmission: "m-anish",
        reviewedAt,
        entries: [
          {
            id: "e-1",
            updateId: "u-1",
            projectId: "p-1",
            progress: "amongus",
            hours: 3,
          },
        ],
      },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return base as StoreShape;
}

beforeEach(() => {
  calls = [];
});

describe("persistDiff picks the right verb", () => {
  test("marking a check-in read is an UPDATE, not an upsert", async () => {
    const before = storeWith(undefined);
    const after = storeWith("2026-08-09");

    await persistDiff(fakeClient(), before, after);

    const onUpdates = calls.filter((c) => c.table === "progress_updates");
    assert.deepEqual(
      onUpdates.map((c) => c.verb),
      ["update"],
      "an upsert here asks Postgres for INSERT rights the Lead correctly doesn't have"
    );
  });

  test("answering somebody's section is an UPDATE too", async () => {
    const before = storeWith("2026-08-09");
    const after = storeWith("2026-08-09");
    after.progressUpdates[0].entries[0].response = "Nice work.";
    after.progressUpdates[0].entries[0].respondedBy = "m-tyler";

    await persistDiff(fakeClient(), before, after);

    const onEntries = calls.filter((c) => c.table === "update_entries");
    assert.deepEqual(
      onEntries.map((c) => c.verb),
      ["update"],
      "update_entries_respond_re is an UPDATE policy — an upsert never reaches it"
    );
  });

  test("a genuinely new row still inserts", async () => {
    const before = storeWith("2026-08-09");
    const after = storeWith("2026-08-09");
    after.progressUpdates.push({
      ...after.progressUpdates[0],
      id: "u-2",
      entries: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await persistDiff(fakeClient(), before, after);

    const onUpdates = calls.filter((c) => c.table === "progress_updates");
    assert.deepEqual(
      onUpdates.map((c) => c.verb),
      ["upsert"]
    );
  });

  test("a new row and an edited row are two different statements", async () => {
    const before = storeWith(undefined);
    const after = storeWith("2026-08-09");
    after.progressUpdates.push({
      ...after.progressUpdates[0],
      id: "u-2",
      entries: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await persistDiff(fakeClient(), before, after);

    const verbs = calls
      .filter((c) => c.table === "progress_updates")
      .map((c) => c.verb)
      .sort();
    assert.deepEqual(verbs, ["update", "upsert"]);
  });

  test("nothing changed means nothing is written", async () => {
    await persistDiff(
      fakeClient(),
      storeWith("2026-08-09"),
      storeWith("2026-08-09")
    );
    assert.deepEqual(calls, []);
  });

  test("a removed row is still a delete", async () => {
    const before = storeWith("2026-08-09");
    const after = storeWith("2026-08-09");
    after.progressUpdates = [];

    await persistDiff(fakeClient(), before, after);

    assert.ok(
      calls.some((c) => c.table === "progress_updates" && c.verb === "delete")
    );
  });
});
