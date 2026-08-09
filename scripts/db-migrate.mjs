#!/usr/bin/env node
/**
 * Apply the migrations to Supabase over a direct Postgres connection.
 *
 *   SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres" \
 *     node scripts/db-migrate.mjs
 *
 * NOTE: that direct `db.<ref>.supabase.co` host is IPv6-only and does not
 * resolve on many networks. It fails with ENOTFOUND, which reads like a typo in
 * the hostname rather than a routing problem, and cost a session before the
 * pattern was spotted. Use the POOLER instead:
 *
 *   postgresql://postgres.<ref>:PASSWORD@aws-0-ca-central-1.pooler.supabase.com:5432/postgres
 *
 * The username carries the project ref for the pooler. That form works, and is
 * what scripts/verify-live.ts already uses.
 *
 * The connection string is read from the environment and NEVER written to disk
 * or committed — it contains the database superuser password, which is the one
 * credential that bypasses RLS entirely.
 *
 * Each migration runs inside its own transaction, so a failure rolls that file
 * back rather than leaving the schema half-built. Files are applied in numeric
 * order and the run stops at the first failure — a later migration assuming
 * tables an earlier one didn't create produces a confusing cascade otherwise.
 *
 * Requires the `pg` package. Install it transiently with `npm i --no-save pg`;
 * it is deliberately not a project dependency, because the app never talks to
 * Postgres directly — it goes through Supabase's client and RLS.
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "Set SUPABASE_DB_URL first. Supabase Dashboard -> Project Settings ->\n" +
      "Database -> Connection string (URI). Percent-encode any special\n" +
      "characters in the password."
  );
  process.exit(1);
}

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const only = process.argv[2];
const todo = only ? files.filter((f) => f.startsWith(only)) : files;

if (todo.length === 0) {
  console.error(`No migrations matched ${only ?? "*"}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  // Supabase terminates TLS with a cert this client has no root for. The
  // connection is still encrypted; we're just not verifying the chain.
  ssl: { rejectUnauthorized: false },
  // Fail fast rather than hanging for two minutes if the host is unreachable
  // (the direct db.* host is IPv6-only on some networks — use the pooler then).
  connectionTimeoutMillis: 20_000,
});

await client.connect();

/**
 * Which migrations have already run.
 *
 * The ledger is itself created by 0008, so on a database that predates it this
 * query fails and we treat everything as unapplied — which is correct, and is
 * exactly the bootstrap case.
 */
let alreadyApplied = new Set();
try {
  const { rows } = await client.query("select version from schema_migrations");
  alreadyApplied = new Set(rows.map((r) => r.version));
} catch {
  console.log("(no schema_migrations table yet — 0008 creates it)\n");
}

const pending = todo.filter((f) => !alreadyApplied.has(f.replace(/\.sql$/, "")));
const skipped = todo.length - pending.length;

if (skipped > 0) {
  console.log(`Skipping ${skipped} already recorded in schema_migrations.`);
}
if (pending.length === 0) {
  console.log("Nothing to apply — the database is up to date.");
  await client.end();
  process.exit(0);
}

console.log(`Connected. Applying ${pending.length} migration(s).\n`);

let applied = 0;
for (const file of pending) {
  const sql = readFileSync(join(DIR, file), "utf8");
  const version = file.replace(/\.sql$/, "");
  process.stdout.write(`  ${file} … `);
  try {
    await client.query("begin");
    await client.query(sql);
    // Recorded inside the same transaction as the migration itself, so the
    // ledger can never claim something that was rolled back.
    await client.query(
      `insert into schema_migrations (version, checksum) values ($1, $2)
       on conflict (version) do nothing`,
      [version, String(sql.length)]
    );
    await client.query("commit");
    console.log("ok");
    applied++;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`\n${file} failed and was rolled back:\n  ${error.message}`);
    if (error.hint) console.error(`  hint: ${error.hint}`);
    console.error(
      `\n${applied} migration(s) applied before this one. Fix the SQL and\n` +
        `re-run just this file:  node scripts/db-migrate.mjs ${file.slice(0, 4)}`
    );
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(`\nAll ${applied} applied. Verify with: npm run db:check`);
