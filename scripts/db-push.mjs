#!/usr/bin/env node
/**
 * Apply pending migrations over the Supabase Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run db:push           # apply what's missing
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run db:push -- --dry  # list, change nothing
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run db:push -- --sql "select 1"
 *
 * ===========================================================================
 * Why this exists instead of a Postgres connection
 * ===========================================================================
 *
 * Every route to the database from a developer machine was blocked, and it took
 * an afternoon to establish which. Recorded so nobody repeats it:
 *
 *   1. **Shared pooler** — `aws-0-ca-central-1.pooler.supabase.com:5432` as
 *      `postgres.<ref>`. Host, port, database and user all verified against the
 *      dashboard's own connection string. The tenant resolves there and nowhere
 *      else (all 32 shared endpoints swept). Four separately-reset passwords all
 *      returned `28P01 password authentication failed`. No network bans, no
 *      network restrictions. Supavisor rejecting a credential the dashboard says
 *      it just set is a Supabase-side problem, not a client one.
 *   2. **Direct connection** — `db.<ref>.supabase.co` exists, but AAAA only
 *      (`2600:1f11:...`). This machine has no IPv6 egress, so it is unreachable
 *      whatever the password is.
 *   3. **An A record for that host** — does not exist. IPv4 needs the paid
 *      add-on.
 *
 * The Management API needs none of it: plain HTTPS over IPv4, authenticated with
 * a personal access token, running arbitrary SQL. Same mechanism the official
 * Supabase MCP server uses, without the OAuth flow.
 *
 * ===========================================================================
 * The token
 * ===========================================================================
 *
 * A Supabase **personal access token** (`sbp_...`), from the dashboard under
 * Account Settings -> Access Tokens. It is account-wide — it reaches every
 * project on the account, which is strictly more than the database password
 * could. So:
 *
 *   - Read from the environment, and **never written to a file** by this script.
 *   - `PROJECT_REF` is hard-coded below, so no argument can point this at another
 *     project.
 *   - Revoke it when a batch is done. Making another costs one click.
 *
 * ===========================================================================
 * How it decides what to apply
 * ===========================================================================
 *
 * `schema_migrations` is the source of truth, and every migration file ends by
 * inserting its own version into it. Read the table, diff against the filenames,
 * apply the difference in filename order.
 *
 * Each file goes in as ONE batch, which matters: several depend on earlier
 * statements in the same file (create table, then alter, then policies).
 * Splitting on `;` would also break every file whose comment strings contain a
 * semicolon — `0004` has 36 of them and `0047` has 2.
 *
 * **Never point this at `APPLY_ALL.sql`.** That bundle is the whole history and
 * is not re-runnable: `0001` has `create type global_role as enum (...)`, which
 * takes no `if not exists`. Against a live database it dies on the first
 * statement with `42710: type "global_role" already exists` and nothing after it
 * runs. `npm run db:pending` generates the re-runnable subset.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = "ldijsmcnjrihwvxtypqy";
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const DIR = "supabase/migrations";

// ---------------------------------------------------------------------------

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
const TOKEN = env.SUPABASE_ACCESS_TOKEN || env.SKR_SUPABASE_PAT;

/** Run one SQL string. Throws with the server's own message on failure. */
async function query(sql) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).message ?? text;
    } catch {
      /* not JSON — use the raw body */
    }
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return text ? JSON.parse(text) : [];
}

const version = (file) => file.replace(/\.sql$/, "");

/**
 * Wrapped in main() with a real try/catch.
 *
 * A rejected top-level `await` in an ESM module is not an `unhandledRejection`:
 * on Windows it exits with `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)` and says nothing about the cause. A bad token produced
 * exactly that, which is a worse failure than the one it was trying to report.
 */
async function main() {
  if (!TOKEN) {
    console.error(
      [
        "",
        "No access token.",
        "",
        "  Supabase dashboard -> your avatar -> Account Settings -> Access Tokens",
        "  -> Generate new token, then:",
        "",
        "    SUPABASE_ACCESS_TOKEN=sbp_... npm run db:push",
        "",
        "It is account-wide, so revoke it once the batch is done.",
        "",
      ].join("\n")
    );
    return 1;
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const sqlIdx = args.indexOf("--sql");

  if (sqlIdx !== -1) {
    // Ad-hoc query. Prints what comes back rather than formatting it — this is
    // for checking, not for reports.
    console.log(JSON.stringify(await query(args[sqlIdx + 1]), null, 2));
    return 0;
  }

  console.log(`\nproject ${PROJECT_REF}`);

  // Prove the token works on a harmless read before running any DDL, so a bad
  // token fails here rather than halfway through a batch.
  const who = await query(
    "select current_user, current_database(), version() as v"
  );
  console.log(
    `connected as ${who[0].current_user} -> ${who[0].current_database}`
  );
  console.log(`${who[0].v.split(" on ")[0]}\n`);

  const applied = new Set(
    (await query("select version from schema_migrations")).map((r) => r.version)
  );
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const pending = files.filter((f) => !applied.has(version(f)));

  console.log(`${applied.size} applied, ${files.length} on disk`);
  if (pending.length === 0) {
    console.log("nothing pending.\n");
    return 0;
  }

  console.log(`${pending.length} pending:`);
  for (const f of pending) console.log(`  ${f}`);

  if (dryRun) {
    console.log("\n--dry, so nothing was applied.\n");
    return 0;
  }

  console.log("");
  let failed = 0;
  for (const f of pending) {
    process.stdout.write(`  ${f} ... `);
    try {
      await query(readFileSync(join(DIR, f), "utf8"));
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.log(`      ${e.message}`);
      failed += 1;
      // Stop on the first failure. Migrations are ordered and a later one may
      // depend on this one; carrying on turns one clear error into several
      // confusing ones.
      break;
    }
  }

  // Read the ledger back rather than trusting the absence of an error — the same
  // reason `persistDiff` checks affected rows.
  const after = new Set(
    (await query("select version from schema_migrations")).map((r) => r.version)
  );
  const missing = files.filter((f) => !after.has(version(f)));

  console.log("");
  console.log(
    missing.length > 0
      ? `still not applied: ${missing.join(", ")}`
      : "every migration on disk is applied."
  );
  console.log("");
  return failed > 0 ? 1 : 0;
}

/*
  `process.exitCode` rather than `process.exit()`.

  Calling `process.exit()` while a fetch socket is still closing crashes Node on
  Windows with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — and it
  fires AFTER the real error has printed, so the useful message scrolls away
  behind a libuv stack trace. Setting the code and letting the loop drain exits
  just as non-zero and says only what happened.
*/
try {
  process.exitCode = await main();
} catch (e) {
  console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
