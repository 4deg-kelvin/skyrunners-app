#!/usr/bin/env node
/**
 * Write `supabase/PENDING.sql` — only the migrations not yet applied.
 *
 *   npm run db:pending                    # ask the database what's applied
 *   npm run db:pending -- --from 0044     # or just say, if you have no access
 *
 * ===========================================================================
 * Why this exists and `APPLY_ALL.sql` is not enough
 * ===========================================================================
 *
 * `APPLY_ALL.sql` is the whole history in one paste, for standing up a fresh
 * database. It is **not re-runnable**, and pasting it into a live one fails on
 * the first statement:
 *
 *     ERROR: 42710: type "global_role" already exists
 *
 * `0001` has `create type global_role as enum (...)`, and `create type` takes no
 * `if not exists`. The SQL editor aborts the whole batch, so nothing after it
 * runs. That happened on 2026-08-25 and cost a round trip.
 *
 * The migrations from `0044` on are all written to be re-runnable — `create table
 * if not exists`, `create index if not exists`, every `create policy` preceded by
 * a matching `drop policy if exists` — so a bundle of just the pending ones is
 * safe to paste, and safe to paste twice.
 *
 * This checks that property before writing, rather than trusting it. A bundle
 * that claims to be re-runnable and isn't is worse than no bundle.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const OUT = "supabase/PENDING.sql";
const PROJECT_REF = "ldijsmcnjrihwvxtypqy";

function envFromFile() {
  const out = {};
  if (!existsSync(".env.local")) return out;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
  }
  return out;
}

const env = { ...envFromFile(), ...process.env };
const version = (file) => file.replace(/\.sql$/, "");

/**
 * Which versions the database already has.
 *
 * Uses the Management API when a token is available, because that is the one
 * route to this database that works — see the header of `db-push.mjs` for the
 * three that don't. Falls back to `--from`, so this is usable with no access at
 * all.
 */
async function appliedVersions() {
  const token = env.SUPABASE_ACCESS_TOKEN || env.SKR_SUPABASE_PAT;
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");

  if (fromIdx !== -1) {
    const from = args[fromIdx + 1];
    console.log(`assuming everything before ${from} is applied (--from)`);
    return { known: false, from };
  }

  if (!token) {
    throw new Error(
      "No SUPABASE_ACCESS_TOKEN, so I cannot ask the database what is applied.\n" +
        "Either set one (see scripts/db-push.mjs) or say where to start:\n\n" +
        "  npm run db:pending -- --from 0049\n"
    );
  }

  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "select version from schema_migrations" }),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return { known: true, set: new Set(rows.map((r) => r.version)) };
}

/** Anything in here means the bundle cannot safely be pasted twice. */
function notRerunnable(sql) {
  const bare = sql
    .split("\n")
    .map((l) => l.split("--")[0])
    .join("\n");
  const problems = [];
  const count = (re) => (bare.match(re) ?? []).length;

  if (count(/create\s+type\s/gi)) problems.push("create type");
  if (count(/create\s+table\s+(?!if\s+not\s+exists)/gi)) {
    problems.push("create table without IF NOT EXISTS");
  }
  if (count(/create\s+index\s+(?!if\s+not\s+exists)/gi)) {
    problems.push("create index without IF NOT EXISTS");
  }
  // A `create policy` is fine only if a `drop policy if exists` covers it.
  const creates = count(/create\s+policy/gi);
  const drops = count(/drop\s+policy\s+if\s+exists/gi);
  if (creates > drops) {
    problems.push(`${creates} create policy vs ${drops} drop policy if exists`);
  }
  return problems;
}

// ---------------------------------------------------------------------------

async function main() {
  const applied = await appliedVersions();
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = applied.known
    ? files.filter((f) => !applied.set.has(version(f)))
    : files.filter((f) => f >= applied.from);

  if (pending.length === 0) {
    console.log("\nnothing pending — not writing PENDING.sql.\n");
    return 0;
  }

  const bodies = pending.map((f) => readFileSync(join(DIR, f), "utf8"));
  const problems = notRerunnable(bodies.join("\n"));
  if (problems.length > 0) {
    console.error(
      `\nRefusing to write ${OUT}: the pending set is not re-runnable.\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\n\nFix the migration, or paste the files one at a time.\n"
    );
    return 1;
  }

  const header = [
    "-- ===========================================================================",
    `-- PENDING.sql — the ${pending.length} migration(s) not yet applied`,
    "-- ===========================================================================",
    "--",
    "-- Generated by `npm run db:pending`. Paste this into the Supabase SQL Editor.",
    "--",
    "-- Do NOT paste APPLY_ALL.sql into a live database: it is the whole history and",
    "-- `0001` has `create type global_role as enum (...)`, which has no",
    "-- `if not exists`. It aborts on the first statement with",
    '-- `42710: type "global_role" already exists` and nothing after it runs.',
    "--",
    "-- Everything here is re-runnable, checked before writing: no `create type`, no",
    "-- `create table`/`create index` without `if not exists`, and every",
    "-- `create policy` covered by a `drop policy if exists`.",
    "--",
    "-- Each file ends by inserting its own version into `schema_migrations`, so",
    "-- `npm run db:check` will show them applied afterwards.",
    "--",
    "-- Contains:",
    ...pending.map((f) => `--   * ${version(f)}`),
    "--",
    "",
    "",
  ].join("\n");

  const parts = pending.map((f, i) =>
    [
      "-- ===========================================================================",
      `-- BEGIN ${f}`,
      "-- ===========================================================================",
      "",
      bodies[i].trimEnd(),
      "",
      `-- END ${f}`,
      "",
      "",
    ].join("\n")
  );

  writeFileSync(OUT, header + parts.join(""), "utf8");
  console.log(`\nwrote ${OUT} — ${pending.length} migration(s):`);
  for (const f of pending) console.log(`  ${f}`);
  console.log("");
  return 0;
}

// `exitCode`, not `exit()` — see the note in db-push.mjs.
try {
  process.exitCode = await main();
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
