#!/usr/bin/env node
/**
 * Concatenate every migration into one file you can paste in one go.
 *
 *   npm run db:bundle
 *
 * Applying seven files in the right order through a web SQL editor is seven
 * chances to skip one, and skipping one here is not a small mistake: miss 0004
 * and the whole database is readable by anyone holding the publishable key;
 * miss 0005 and every sign-in dead-ends forever.
 *
 * So: one ordered file, `supabase/APPLY_ALL.sql`, with a banner between each
 * source migration so an error message still tells you which one failed.
 *
 * The individual files stay the source of truth — this is generated output and
 * is regenerated, never hand-edited.
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DIR = join(import.meta.dirname, "..", "supabase", "migrations");
const OUT = join(import.meta.dirname, "..", "supabase", "APPLY_ALL.sql");

const files = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort(); // numeric prefixes make lexical sort the correct order

if (files.length === 0) {
  console.error("No migrations found.");
  process.exit(1);
}

const banner = (text) =>
  `\n\n-- ${"=".repeat(74)}\n-- ${text}\n-- ${"=".repeat(74)}\n\n`;

let out =
  "-- GENERATED FILE — do not edit. Regenerate with `npm run db:bundle`.\n" +
  "--\n" +
  "-- Every migration, in order, as one script. Paste the whole thing into the\n" +
  "-- Supabase SQL editor (Dashboard -> SQL Editor -> New query) and run once.\n" +
  "--\n" +
  "-- Safe to run on an EMPTY database. It is NOT idempotent as a whole: 0001-0003\n" +
  "-- use bare `create table`, so re-running on a populated database will error on\n" +
  "-- the first table that already exists. That's deliberate — failing loudly beats\n" +
  "-- silently half-applying a schema.\n" +
  "--\n" +
  "-- Afterwards, verify from the repo with:  npm run db:check\n" +
  `--\n-- Sources: ${files.join(", ")}\n`;

for (const file of files) {
  out += banner(`BEGIN ${file}`);
  out += readFileSync(join(DIR, file), "utf8").trimEnd();
  out += `\n${banner(`END ${file}`).trimEnd()}\n`;
}

writeFileSync(OUT, out);

console.log(`Wrote supabase/APPLY_ALL.sql (${files.length} migrations)\n`);
files.forEach((f) => console.log(`  ${f}`));
console.log(
  "\nPaste it into the Supabase SQL editor and run, then `npm run db:check`."
);
