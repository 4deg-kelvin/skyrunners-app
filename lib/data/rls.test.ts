/**
 * Every table the app deletes from needs a DELETE policy.
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * **RLS does not raise on a missing policy.** The statement simply matches no
 * rows, PostgREST returns success, and the app reports that it worked. This is
 * the most expensive bug shape in the project and it has now happened three
 * times:
 *
 *   - `profiles` had no DELETE policy, so "delete this broken profile" said
 *     "Record deleted." and did nothing (fixed in 0019).
 *   - `join_requests` had none, so `deleteProject` and `deleteMember` — both of
 *     which clear join requests on cascade — could not complete (fixed in 0022).
 *   - `work_logs` allowed only your own, so a Co-Lead deleting somebody's
 *     record hit the same wall (also 0022).
 *
 * Nothing in the type system can see any of it: `operations.ts` reassigns a
 * plain array and the SQL lives in another language in another directory.
 *
 * So this reads both sides. It finds every collection an operation clears, and
 * checks the migrations declare a policy that can delete from that table. It
 * cannot verify the policy's CONDITION is right — that still needs a human —
 * but "there is no policy at all" is the case that keeps shipping.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");
}

/**
 * `store.foo = store.foo.filter(...)` is how every cascade is written, so the
 * collection keys that appear on the left of one are the tables that get
 * DELETEs. Reassignment specifically — `.push()` is an insert and `x.field =`
 * is an update.
 */
function cascadedCollections(): Set<string> {
  const ops = readFileSync(join(ROOT, "lib", "store", "operations.ts"), "utf8");
  const keys = new Set<string>();
  for (const m of ops.matchAll(/store\.(\w+)\s*=\s*store\.\1\.filter/g)) {
    keys.add(m[1]);
  }
  return keys;
}

/** Collection key -> table name, read from the mapping rather than guessed. */
function tableFor(key: string): string | null {
  const mapping = readFileSync(
    join(ROOT, "lib", "store", "mapping.ts"),
    "utf8"
  );
  const m = mapping.match(
    new RegExp(`key:\\s*"${key}",\\s*\\n\\s*table:\\s*"(\\w+)"`)
  );
  return m ? m[1] : null;
}

describe("cascade deletes have a policy behind them", () => {
  const sql = allMigrationSql();

  test("the scan finds the cascades at all", () => {
    // If the shape of `operations.ts` changes, this test must fail loudly
    // rather than pass by finding nothing.
    const found = cascadedCollections();
    assert.ok(
      found.size >= 8,
      `expected several cascaded collections, found ${found.size}`
    );
    assert.ok(found.has("joinRequests"), "joinRequests should be cascaded");
    assert.ok(found.has("workLogs"), "workLogs should be cascaded");
  });

  test("every cascaded table can actually be deleted from", () => {
    const missing: string[] = [];

    for (const key of cascadedCollections()) {
      const table = tableFor(key);
      // Not every collection is a table of its own — update entries and help
      // replies ride inline on their parent and are handled separately.
      if (!table) continue;

      const canDelete = new RegExp(
        `create policy \\w+ on ${table}\\s+for (all|delete)\\b`
      ).test(sql);

      if (!canDelete) missing.push(`${table} (from store.${key})`);
    }

    assert.deepEqual(
      missing,
      [],
      `These tables get cleared on cascade but have no DELETE policy, so the ` +
        `operation will fail against Postgres while passing every test here:\n` +
        missing.map((m) => `  - ${m}`).join("\n")
    );
  });

  test("profiles keeps its delete policy", () => {
    // The original of this bug class. Pinned so a policy rewrite can't drop it.
    assert.match(sql, /create policy \w+ on profiles\s+for delete/);
  });
});
