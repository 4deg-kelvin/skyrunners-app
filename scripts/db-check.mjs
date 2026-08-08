#!/usr/bin/env node
/**
 * Is the Supabase database actually ready?
 *
 *   npm run db:check
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and the publishable/anon key from `.env.local`
 * and reports, per table, whether it exists and how many rows it has.
 *
 * This exists because the app is built by two people across a boundary: Anish
 * writes the app, Kelvin owns the database. "It doesn't work" is a useless bug
 * report across that boundary — "migrations 0001-0007 have not been applied, so
 * every table 404s" is actionable by exactly one of them, immediately.
 *
 * Uses PostgREST directly rather than the Supabase client so it can run as a
 * plain script with no bundler and no session.
 */

import { readFileSync, existsSync } from "fs";

const ENV_FILE = ".env.local";

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...readEnv(), ...process.env };
const base = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!base || !key) {
  console.log(
    "No Supabase credentials found.\n\n" +
      `Put these in ${ENV_FILE}:\n` +
      "  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co\n" +
      "  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...\n\n" +
      "Without them the app runs in demo mode, which is a working app — this is\n" +
      "not an error unless you were expecting live data."
  );
  process.exit(0);
}

/** Every table the app reads, and which migration creates it. */
const TABLES = [
  ["profiles", "0001"],
  ["lead_history", "0001"],
  ["teams", "0001"],
  ["team_memberships", "0001"],
  ["projects", "0001"],
  ["project_members", "0001"],
  ["work_logs", "0001"],
  ["deliverables", "0002"],
  ["terms", "0002"],
  ["update_schedules", "0002"],
  ["join_requests", "0003"],
  ["progress_updates", "0007"],
  ["update_entries", "0007"],
  ["project_artifacts", "0007"],
  ["events", "0007"],
];

console.log(`Checking ${base}\n`);

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Prefer: "count=exact",
};

const missing = new Set();
let present = 0;
let blocked = 0;

for (const [table, migration] of TABLES) {
  let status;
  try {
    const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=0`, {
      headers,
    });
    if (res.status === 200) {
      // content-range looks like "*/12" — the total after the slash.
      const count = (res.headers.get("content-range") || "*/?").split("/")[1];
      status = `ok      ${count} rows`;
      present++;
    } else {
      const body = await res.json().catch(() => ({}));
      if (body.code === "PGRST205") {
        status = `MISSING (migration ${migration} not applied)`;
        missing.add(migration);
      } else if (res.status === 401 || res.status === 403) {
        // RLS with no policy denies everything, which is the safe direction.
        status = `blocked by RLS (table exists)`;
        blocked++;
      } else {
        status = `${res.status} ${body.message ?? ""}`.slice(0, 60);
      }
    }
  } catch (error) {
    status = `unreachable — ${error.message}`;
  }
  console.log(`  ${table.padEnd(20)} ${status}`);
}

console.log("");

if (missing.size > 0) {
  const list = [...missing].sort();
  console.log(
    `${TABLES.length - present - blocked} table(s) missing.\n\n` +
      `KELVIN: apply these migrations, in order, in the Supabase SQL editor:\n` +
      list.map((m) => `  supabase/migrations/${m}_*.sql`).join("\n") +
      `\n\nAll of 0001-0007 should be applied in numeric order. 0004 (RLS) and\n` +
      `0005 (profile provisioning) are hard requirements — without 0004 the\n` +
      `database is readable by anyone with the publishable key, and without\n` +
      `0005 every sign-in dead-ends at /auth/no-profile.\n\n` +
      `Until then the app stays in demo mode, which works fine.`
  );
  process.exit(1);
}

console.log(
  `All ${present + blocked} tables present. The app can run in live mode.\n` +
    (blocked > 0
      ? `${blocked} are RLS-blocked for an anonymous caller, which is expected —\n` +
        `they should become readable once signed in.\n`
      : "")
);
