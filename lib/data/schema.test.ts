/**
 * Does the code agree with the database schema?
 *
 * Run with:  npm test
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * The rest of Phase 1 is "replace each `lib/data/*` body with a real query",
 * and it has to be written before there's a database to run it against. The most
 * likely mistake by a wide margin isn't logic — it's naming: `full_name` typed as
 * `fullname`, a column renamed in a later migration, a table that was never
 * created.
 *
 * PostgREST reports those at runtime, as a 400 on a page nobody loads until
 * launch day. This turns the same class of mistake into a failing test, today,
 * with no database, by reading `supabase/migrations/*.sql` and checking every
 * column the code names actually exists.
 *
 * It cannot check semantics — whether a join is right, whether RLS allows the
 * read. It checks spelling, which is what actually goes wrong.
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { QUERIED_COLUMNS } from "./graph.ts";
import { COLLECTIONS } from "../store/mapping.ts";

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations"
);

/**
 * Parse `create table` and `alter table ... add column` out of the migrations.
 *
 * A deliberately small parser, not a SQL engine. It only has to cope with the
 * style used in this repo — one column per line, lowercase keywords — and it's
 * better for it to under-report than to guess: an unparsed column shows up as a
 * test failure to investigate, which is the safe direction.
 */
function parseSchema(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001, 0002, ... so later migrations amend earlier ones

  for (const file of files) {
    /*
      Strip `--` comments before parsing anything.

      The alter-table matcher runs to the first `;`, and this file's migrations
      are heavily commented — so one semicolon in an English sentence
      ("open to drop in on; a 1:1 is the two people in it") silently truncated
      the statement and reported two real columns as missing. The failure looks
      like a schema bug and isn't, which is the worst kind.

      Line comments only. No migration here uses block comments, and matching
      those properly needs a real tokeniser rather than a regex.
    */
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(
      /--[^\n]*/g,
      ""
    );

    // --- create table -----------------------------------------------------
    const createRe =
      /create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/g;
    let match: RegExpExecArray | null;

    while ((match = createRe.exec(sql)) !== null) {
      const [, table, body] = match;
      const columns = tables.get(table) ?? new Set<string>();

      for (const rawLine of body.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("--")) continue;

        // Table-level clauses, not columns.
        if (
          /^(constraint|primary key|unique|check|foreign key|exclude)\b/i.test(
            line
          )
        ) {
          continue;
        }

        const column = line.match(/^([a-z_][a-z0-9_]*)\s+\S/);
        if (column) columns.add(column[1]);
      }

      tables.set(table, columns);
    }

    // --- alter table add column ------------------------------------------
    //
    // One statement can add several columns:
    //
    //   alter table deliverables
    //     add column if not exists submitted_at timestamptz,
    //     add column if not exists confirmed_by uuid references ...;
    //
    // Matching only the first `add column` after the table name silently missed
    // the rest, which showed up as a real column being reported as missing.
    const alterRe = /alter table (\w+)([\s\S]*?);/g;
    while ((match = alterRe.exec(sql)) !== null) {
      const [, table, body] = match;
      const added = [
        ...body.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/g),
      ];
      if (added.length === 0) continue;

      const columns = tables.get(table) ?? new Set<string>();
      for (const a of added) columns.add(a[1]);
      tables.set(table, columns);
    }
  }

  return tables;
}

const schema = parseSchema();

describe("the migration parser itself", () => {
  // If the parser silently stopped working, every test below would pass
  // vacuously. These are the canary.
  test("found the core tables", () => {
    for (const table of [
      "profiles",
      "projects",
      "project_members",
      "teams",
      "deliverables",
      "join_requests",
    ]) {
      assert.ok(schema.has(table), `Parser did not find table "${table}"`);
    }
  });

  test("found a realistic number of columns on profiles", () => {
    const count = schema.get("profiles")?.size ?? 0;
    assert.ok(count > 10, `Only parsed ${count} columns on profiles`);
  });

  test("does not mistake constraints for columns", () => {
    const columns = schema.get("profiles");
    assert.ok(!columns?.has("constraint"));
    assert.ok(!columns?.has("profiles_stanford_email"));
  });

  test("picks up a column it would be easy to miss", () => {
    // `primary_re_id` sits after a two-line comment in 0001. If the parser
    // tripped over comments, this is where it would show.
    assert.ok(schema.get("projects")?.has("primary_re_id"));
  });
});

describe("every column the data layer reads exists in the schema", () => {
  for (const { table, columns } of QUERIED_COLUMNS) {
    test(`${table}: ${columns.slice(0, 45)}${columns.length > 45 ? "…" : ""}`, () => {
      const actual = schema.get(table);
      assert.ok(actual, `No "create table ${table}" in supabase/migrations/`);

      const missing = columns
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && !actual.has(c));

      assert.deepEqual(
        missing,
        [],
        `${table} has no column(s): ${missing.join(", ")}.\n` +
          `Available: ${[...actual].sort().join(", ")}`
      );
    });
  }
});

/**
 * Enum values must match between the SQL and `lib/types.ts`.
 *
 * This is CLAUDE.md's trap #2, and it's the nastiest failure mode in the repo
 * because it doesn't throw. `global_role` being `admin` in SQL and `co_lead` in
 * TypeScript wouldn't error — `isCoLead()` would simply return false forever,
 * silently disabling every leadership permission in the app.
 *
 * Comparing them as SETS: order is irrelevant to correctness, and Postgres enum
 * order only affects sorting.
 */
describe("SQL enums match the TypeScript unions", () => {
  const sql = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");

  const typesSrc = readFileSync(
    join(import.meta.dirname, "..", "types.ts"),
    "utf8"
  );

  /**
   * The enum as Postgres would have it after every migration has run.
   *
   * `create type` is only the starting set. Enums grow by `alter type … add
   * value`, which is how `advisor` reached `global_role` in 0031 — reading only
   * the create statement made this test compare the TypeScript union against a
   * definition three migrations out of date, and report drift that didn't
   * exist. A check that cries wolf about its own migration history is one
   * somebody eventually deletes.
   */
  function sqlEnum(name: string): string[] | null {
    const created = sql.match(
      new RegExp(`create type ${name} as enum\\s*\\(([^)]*)\\)`)
    );
    if (!created) return null;

    const values = [...created[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    for (const added of sql.matchAll(
      new RegExp(
        `alter type ${name}\\s+add value(?:\\s+if not exists)?\\s+'([^']+)'`,
        "g"
      )
    )) {
      values.push(added[1]);
    }

    return [...new Set(values)].sort();
  }

  function tsUnion(name: string): string[] | null {
    // Matches both one-per-line unions and single-line ones.
    const match = typesSrc.match(
      new RegExp(`export type ${name} =([\\s\\S]*?);`)
    );
    if (!match) return null;
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  }

  const PAIRS: Array<[sqlName: string, tsName: string]> = [
    ["global_role", "GlobalRole"],
    ["member_status", "MemberStatus"],
    ["project_role", "ProjectRole"],
    ["project_phase", "ProjectPhase"],
    ["project_health", "ProjectHealth"],
    ["update_status", "UpdateStatus"],
    ["artifact_kind", "ArtifactKind"],
    ["event_kind", "EventKind"],
  ];

  for (const [sqlName, tsName] of PAIRS) {
    test(`${sqlName} === ${tsName}`, () => {
      const fromSql = sqlEnum(sqlName);
      const fromTs = tsUnion(tsName);

      assert.ok(fromSql, `No "create type ${sqlName}" in supabase/migrations/`);
      assert.ok(fromTs, `No "export type ${tsName}" in lib/types.ts`);
      assert.deepEqual(
        fromSql,
        fromTs,
        `${sqlName} (SQL) and ${tsName} (TS) disagree. This does NOT throw at ` +
          `runtime — comparisons just silently fail forever.`
      );
    });
  }
});

describe("the tables the app renders but 0001-0006 never created", () => {
  // Added by 0007. Without these, `my-work`, `dashboard`, `events` and
  // `find-work` cannot leave mock data — there is nothing to query.
  test("progress_updates and update_entries exist", () => {
    assert.ok(schema.has("progress_updates"));
    assert.ok(schema.has("update_entries"));
  });

  test("the update envelope holds no content", () => {
    // Content belongs in `update_entries`, one row per project. A `progress`
    // or `blockers` column here would recreate the single-blob update that
    // CLAUDE.md explicitly rejects.
    const columns = schema.get("progress_updates");
    assert.ok(!columns?.has("progress"), "progress belongs on update_entries");
    assert.ok(!columns?.has("blockers"), "blockers belongs on update_entries");
  });

  test("update_entries is per-project", () => {
    const columns = schema.get("update_entries");
    assert.ok(columns?.has("project_id"));
    assert.ok(columns?.has("progress"));
    assert.ok(columns?.has("blockers"));
    assert.ok(columns?.has("hours"));
  });

  test("the Lead at submission is snapshotted, not joined live", () => {
    // Leads change mid-quarter. Joining live to profiles.lead_id would re-file
    // historic updates under the new Lead.
    assert.ok(schema.get("progress_updates")?.has("lead_id_at_submission"));
  });

  test("project_artifacts and events exist", () => {
    assert.ok(schema.has("project_artifacts"));
    assert.ok(schema.has("events"));
  });

  test("an artifact can be a link or a file", () => {
    const columns = schema.get("project_artifacts");
    assert.ok(columns?.has("external_url"));
    assert.ok(columns?.has("file_url"));
  });
});

/**
 * Every column the Postgres store maps, checked against the real SQL.
 *
 * This is the check that matters most for going live. `lib/store/mapping.ts`
 * claims a column for every field in `lib/types.ts`, and a claim that's wrong
 * doesn't fail at build time — it fails the first time a member clicks the
 * button that touches it. Adding `submitted_at` to the TypeScript type without
 * adding it to `deliverables` is exactly the drift this caught.
 *
 * Add a collection to COLLECTIONS and it's covered here automatically, which is
 * what keeps this honest as features get added.
 */
describe("the Postgres mapping matches the real schema", () => {
  for (const spec of COLLECTIONS) {
    test(`${spec.table} has every column ${String(spec.key)} maps`, () => {
      const actual = schema.get(spec.table);
      assert.ok(
        actual,
        `No "create table ${spec.table}" in supabase/migrations/`
      );

      const missing = spec.columns
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c && !actual.has(c));

      assert.deepEqual(
        missing,
        [],
        `${spec.table} is missing: ${missing.join(", ")}.\n` +
          `Either add them in a migration, or stop mapping them.\n` +
          `Available: ${[...actual].sort().join(", ")}`
      );
    });
  }

  test("every mapped table actually exists", () => {
    const missing = COLLECTIONS.map((c) => c.table).filter(
      (t) => !schema.has(t)
    );
    assert.deepEqual(missing, []);
  });
});

describe("assumptions the org graph is built on", () => {
  test("profiles.lead_id exists — the reporting chain depends on it", () => {
    assert.ok(schema.get("profiles")?.has("lead_id"));
  });

  test("projects.parent_id exists — the project tree depends on it", () => {
    assert.ok(schema.get("projects")?.has("parent_id"));
  });

  test("project_members has left_at, so departures can be filtered out", () => {
    // Never-hard-delete: without this column the RE filter would count people
    // who left the club last year.
    assert.ok(schema.get("project_members")?.has("left_at"));
  });

  test("the two hierarchies are still separate tables", () => {
    // teams.parent_id is the org tree; projects.parent_id is the work tree.
    // Merging them rebuilds the silos this app exists to remove.
    assert.ok(schema.get("teams")?.has("parent_id"));
    assert.ok(schema.get("projects")?.has("parent_id"));
    assert.notEqual(schema.get("teams"), schema.get("projects"));
  });
});

// ---------------------------------------------------------------------------
// One definition of a profile
// ---------------------------------------------------------------------------

describe("the viewer reads profiles through the shared spec", () => {
  /*
    `lib/data/viewer.ts` fetches the signed-in member directly rather than
    through the snapshot, and used to carry its own hand-written column list.
    That list fell behind three times: `phone`, `discord_user_id` and
    `discord_verified_at` were each added to the mapping and not to it.

    Nothing failed. The query succeeded and the columns were simply absent, so
    the profile form rendered its placeholders on top of values that were
    saved in the database, and the Discord banner could never see that somebody
    had verified. A second column list is a second thing to remember, and this
    test exists so there is only ever one.
  */
  test("it doesn't hand-write its own column list", () => {
    const viewer = readFileSync(
      join(process.cwd(), "lib", "data", "viewer.ts"),
      "utf8"
    );

    // A literal string of comma-separated snake_case columns passed to
    // `.select(...)` is the shape that drifts.
    const handWritten = /\.select\(\s*["'`][a-z_]+,\s*[a-z_]+/.test(viewer);
    assert.equal(
      handWritten,
      false,
      "viewer.ts should select `membersSpec.columns`, not its own list — see the note above"
    );
    assert.match(viewer, /membersSpec\.columns/);
  });

  test("and maps rows with the shared fromRow", () => {
    const viewer = readFileSync(
      join(process.cwd(), "lib", "data", "viewer.ts"),
      "utf8"
    );
    assert.match(viewer, /membersSpec\.fromRow/);
  });
});
