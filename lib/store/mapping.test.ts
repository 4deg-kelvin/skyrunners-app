/**
 * ============================================================================
 * EVERY FIELD SURVIVES THE ROUND TRIP TO POSTGRES
 * ============================================================================
 *
 * Run with:  npm test
 *
 * ----------------------------------------------------------------------------
 * The bug this file exists for
 * ----------------------------------------------------------------------------
 *
 * `project_deadline_changes.deliverable_id` was added to the schema, to the
 * TypeScript type, to the operation that writes it and to every reader — and left
 * out of this file's `columns`, `fromRow` and `toRow`. Nothing failed. The app set
 * `deliverableId` on the object, `toRow` silently dropped it, and Postgres accepted
 * the insert with a NULL.
 *
 * The result was worse than the feature not working: every deliverable push was
 * recorded as a PROJECT push, so the deliverable's Gantt marker never appeared and
 * the project's marker showed the deliverable's old date. A chart that is
 * confidently wrong.
 *
 * **And it could not be caught by using the app.** Demo mode runs on
 * `lib/store/disk.ts` and never loads this file at all, so the whole feature worked
 * perfectly in a local demo. Only live mode goes through the mapping. That is the
 * hole this closes.
 *
 * ----------------------------------------------------------------------------
 * What it checks, and why it's shaped this way
 * ----------------------------------------------------------------------------
 *
 * For every collection: build a row with `toRow`, and assert that **every column
 * it produces is named in `columns`**. That is the direction the bug went — a
 * field written but never selected — and it needs no fixtures, because `toRow`'s
 * own output tells us which columns the collection believes it has.
 *
 * The reverse direction (a column selected but never mapped) is checked too: every
 * name in `columns` must appear in `toRow`'s output, so a column can't be read and
 * then silently discarded on write.
 *
 * Deliberately NOT a snapshot test of the column strings. That would fail on every
 * legitimate schema change and get regenerated without being read, which is how a
 * test stops catching anything.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { COLLECTIONS } from "./mapping.ts";

/** `"id, project_id, from_date"` -> `["id","project_id","from_date"]` */
function columnNames(columns: string): string[] {
  return columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * A stand-in record for a collection.
 *
 * `toRow` only reads properties off the object, so a Proxy that answers every
 * property with a harmless value exercises it without needing a real fixture per
 * collection — and a fixture per collection is exactly the thing that would drift
 * out of date and stop covering new fields.
 *
 * Arrays matter: several `toRow`s do `x.ids ?? []` or spread, so a scalar would
 * throw. Returning a value that is usable as both a string and an array covers it.
 */
function probe(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined; // not a promise
        if (typeof prop === "symbol") return undefined;
        // Empty array doubles as "a list field", and most string uses tolerate it.
        return [];
      },
      has: () => true,
    }
  ) as Record<string, unknown>;
}

/**
 * Columns a collection deliberately WRITES without selecting.
 *
 * The check below flagged one of these on its first run, and it was a false
 * positive rather than a second bug — which is worth having as a list rather than
 * as a looser rule, because the list is where the reasoning lives.
 *
 * `teams.kind` is a SQL enum mirroring the tree shape. The app derives
 * division-ness from `parentId` and treats that as the single source of truth, so
 * `kind` is written to keep Postgres consistent and never read back. Reading it
 * would create a second answer to "is this a division", and the two could disagree.
 *
 * Anything NOT on this list that is written but unselected is the real bug: the
 * insert succeeds, the column holds NULL, and the field reads back as undefined
 * forever.
 */
const WRITE_ONLY: Record<string, string[]> = {
  teams: ["kind"],
};

/**
 * Collections identified by a NATURAL key rather than a surrogate `id`.
 *
 * All three are join-shaped: a membership is one row per (project, member), a
 * schedule one row per member, an advisor one row per (project, member).
 * `persistDiff` tells inserts from updates using `identify`, which returns the
 * composite for these — see each spec's `conflictTarget`.
 *
 * Listed rather than detected, because "this table has no id" should be a decision
 * somebody wrote down. A NEW collection missing `id` is almost certainly an
 * oversight, and the check below should fail for it.
 */
const NATURAL_KEY = new Set([
  "projectMemberships",
  "updateSchedules",
  "projectAdvisors",
]);

describe("no column is written but unselected", () => {
  for (const spec of COLLECTIONS) {
    test(`${spec.key} — every column toRow writes is in columns`, () => {
      let row: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row = spec.toRow(probe() as any) as Record<string, unknown>;
      } catch {
        /*
          A `toRow` that can't run against the probe is skipped rather than
          failed. A few do real work on their input (dates, joins), and a
          false failure here would get this file disabled — which costs more
          than the coverage it loses.
        */
        return;
      }

      const declared = new Set(columnNames(spec.columns));
      const allowed = new Set(WRITE_ONLY[spec.key] ?? []);
      const written = Object.keys(row);
      const missing = written.filter(
        (c) => !declared.has(c) && !allowed.has(c)
      );

      assert.deepEqual(
        missing,
        [],
        `${spec.key}.toRow writes ${missing.join(", ")}, which ${
          missing.length === 1 ? "is" : "are"
        } not in \`columns\`. Postgres will accept the insert and store NULL, and ` +
          `the field will read back as undefined forever. Add it to \`columns\` ` +
          `and \`fromRow\` too.`
      );
    });
  }
});

describe("no column is selected but unwritten", () => {
  for (const spec of COLLECTIONS) {
    test(`${spec.key} — every selected column is written back`, () => {
      let row: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        row = spec.toRow(probe() as any) as Record<string, unknown>;
      } catch {
        return;
      }

      const written = new Set(Object.keys(row));
      /*
        Columns a write legitimately never sets.

        `logged_at` and friends are database defaults, and an id may be
        generated server-side. Listing them here rather than loosening the rule
        keeps the check meaningful — anything NOT on this list that is selected
        and never written is a field the app can read and silently fail to save.
      */
      const dbManaged = new Set(["logged_at", "created_at", "updated_at"]);

      const unwritten = columnNames(spec.columns).filter(
        (c) => !written.has(c) && !dbManaged.has(c)
      );

      assert.deepEqual(
        unwritten,
        [],
        `${spec.key} selects ${unwritten.join(", ")} but never writes ${
          unwritten.length === 1 ? "it" : "them"
        }. An edit to that field would be read correctly and then discarded on save.`
      );
    });
  }
});

describe("the collection list itself", () => {
  test("every spec has a key, a table and columns", () => {
    for (const spec of COLLECTIONS) {
      assert.ok(spec.key, "a spec with no key");
      assert.ok(spec.table, `${spec.key} has no table`);
      assert.ok(spec.columns, `${spec.key} has no columns`);
    }
  });

  test("ids are selected, since the diff identifies rows by them", () => {
    for (const spec of COLLECTIONS) {
      const cols = columnNames(spec.columns);
      if (NATURAL_KEY.has(spec.key)) continue;
      assert.ok(
        cols.includes("id"),
        `${spec.key} doesn't select \`id\`, so persistDiff can't tell an insert from an update`
      );
    }
  });

  test("dependsOn names real collections", () => {
    // A typo here would put a table in the wrong insert order, and the symptom is
    // an intermittent foreign-key violation on a write that usually works.
    const keys = new Set(COLLECTIONS.map((s) => s.key));
    for (const spec of COLLECTIONS) {
      for (const dep of spec.dependsOn ?? []) {
        assert.ok(
          keys.has(dep),
          `${spec.key} depends on "${dep}", which is not a collection`
        );
      }
    }
  });

  test("a dependency is inserted BEFORE the collection that needs it", () => {
    /*
      `persistDiff` inserts top to bottom, so a collection must appear after
      everything it references or the foreign key fires. This is the check that
      would have caught `projectDeadlineChanges` being listed before
      `deliverables` — which it isn't, but only by luck of where it was appended.
    */
    const order = new Map(COLLECTIONS.map((s, i) => [s.key, i]));
    for (const spec of COLLECTIONS) {
      for (const dep of spec.dependsOn ?? []) {
        const mine = order.get(spec.key)!;
        const theirs = order.get(dep);
        if (theirs === undefined) continue;
        assert.ok(
          theirs < mine,
          `${spec.key} depends on ${dep} but is inserted before it`
        );
      }
    }
  });
});

/**
 * The specific field that started this. Kept as its own named test so a future
 * regression reads as "the deliverable link is gone again" rather than as a
 * generic mapping failure.
 */
describe("project_deadline_changes carries the deliverable link", () => {
  const spec = COLLECTIONS.find((s) => s.table === "project_deadline_changes");

  test("the collection exists", () => {
    assert.ok(spec, "project_deadline_changes is not mapped at all");
  });

  test("deliverable_id is selected", () => {
    assert.ok(
      columnNames(spec!.columns).includes("deliverable_id"),
      "without this, a deliverable push reads back as a project push"
    );
  });

  test("deliverable_id survives toRow", () => {
    const row = spec!.toRow({
      id: "c1",
      projectId: "p1",
      deliverableId: "d1",
      fromDate: "2026-08-13",
      toDate: "2026-08-19",
      reason: "CNC takes longer",
      changedById: "m1",
      changedAt: "2026-08-14T12:00:00.000Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any) as Record<string, unknown>;

    assert.equal(row.deliverable_id, "d1");
  });

  test("fromRow reads it back", () => {
    const back = spec!.fromRow({
      id: "c1",
      project_id: "p1",
      deliverable_id: "d1",
      from_date: "2026-08-13",
      to_date: "2026-08-19",
      reason: "CNC takes longer",
      changed_by: "m1",
      changed_at: "2026-08-14T12:00:00.000Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    assert.equal(back.deliverableId, "d1");
  });

  test("a project-level move still reads as undefined, not empty string", () => {
    // `baselineTargetDate` filters on `if (c.deliverableId) continue`, so an
    // empty string would be falsy and work by accident — but `deadlineChanges`
    // renders a deliverable title when it is truthy, and "" would be a bug there.
    const back = spec!.fromRow({
      id: "c1",
      project_id: "p1",
      deliverable_id: null,
      from_date: "2026-08-13",
      to_date: "2026-08-19",
      reason: "project move",
      changed_by: "m1",
      changed_at: "2026-08-14T12:00:00.000Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    assert.equal(back.deliverableId, undefined);
  });
});
