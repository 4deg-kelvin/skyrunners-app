#!/usr/bin/env node
/**
 * Deletes the test environment from the codebase.
 *
 *   npm run remove:test-env
 *
 * Run this when the club is using the app for real and the persona switcher has
 * served its purpose. It is NOT required before shipping — the switcher is off
 * unless `SKYRUNNERS_TEST_ENV=1` is set, and cannot run alongside real data at
 * all (see the interlock in `lib/env.ts`). This is tidying, not a safety step.
 *
 * How it works: every integration point in the app is wrapped in sentinel
 * comments, so removal is mechanical rather than a hunt.
 *
 *     // TEST-ENV:START
 *     const viewerId = (await readTestPersonaId()) ?? CURRENT_USER_ID;
 *     // TEST-ENV:REPLACE-WITH const viewerId = CURRENT_USER_ID;
 *     // TEST-ENV:END
 *
 * The block is deleted. If it carries a REPLACE-WITH line, that payload is left
 * behind in its place — which is how a block sitting mid-function can be removed
 * without leaving code that no longer compiles.
 *
 * Markdown is deliberately NOT scanned: prose that *describes* the markers would
 * be mangled by a tool that strips them. Doc cleanup is listed at the end for you
 * to do by hand.
 */

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

const START = "TEST-ENV:START";
const END = "TEST-ENV:END";
const REPLACE = "TEST-ENV:REPLACE-WITH";

/** The whole feature lives in one directory. */
const TEST_ENV_DIR = join(ROOT, "lib", "test-env");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude",
  "dist",
  "build",
]);

/** Extensions worth scanning. Markdown excluded on purpose — see above. */
const SCAN_EXT = [".ts", ".tsx", ".mjs", ".js", ".jsx", ".css"];
const SCAN_NAMES = [".env.example"];

/** This file contains the markers as data, so it must never scan itself. */
const SELF = resolve(import.meta.filename);

function shouldScan(path) {
  if (resolve(path) === SELF) return false;
  if (resolve(path).startsWith(TEST_ENV_DIR)) return false;
  const name = path.split(/[\\/]/).pop() ?? "";
  return SCAN_EXT.some((e) => name.endsWith(e)) || SCAN_NAMES.includes(name);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (shouldScan(full)) out.push(full);
  }
  return out;
}

/**
 * Strip marker blocks from one file's text.
 *
 * Returns `null` when the file has no markers, so untouched files are never
 * rewritten — that keeps the summary honest and avoids churning mtimes.
 */
function strip(text) {
  // This repo is developed on Windows, so most files are CRLF. Split on either
  // and rejoin with whatever the file already used — a stripped file that comes
  // back with mixed endings shows up as a whole-file diff in review, which
  // buries the change that actually matters.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const kept = [];
  let removed = 0;
  let inBlock = false;
  let indent = "";
  let replacement = null;

  for (const line of lines) {
    if (!inBlock && line.includes(START)) {
      inBlock = true;
      indent = line.match(/^\s*/)?.[0] ?? "";
      replacement = null;
      removed++;
      continue;
    }

    if (inBlock) {
      removed++;

      if (line.includes(REPLACE)) {
        // Everything after the marker is the payload. Trim any comment tail the
        // host language required, e.g. `*/` or `-->`.
        replacement = line
          .slice(line.indexOf(REPLACE) + REPLACE.length)
          .replace(/(\*\/|-->|\}\))\s*$/, "")
          .trim();
      }

      if (line.includes(END)) {
        inBlock = false;
        if (replacement) kept.push(indent + replacement);
        // Collapse the blank line a removed block usually leaves behind.
        if (!replacement && kept.at(-1)?.trim() === "") kept.pop();
      }
      continue;
    }

    kept.push(line);
  }

  if (inBlock) {
    throw new Error(`Unclosed ${START} block — no matching ${END}`);
  }

  return removed === 0 ? null : { text: kept.join(eol), removed };
}

/**
 * Drop the `remove:test-env` npm script.
 *
 * Done as text rather than parse-and-restringify so the rest of package.json
 * keeps its formatting, then validated by re-parsing before it's written.
 */
function cleanPackageJson() {
  const path = join(ROOT, "package.json");
  const before = readFileSync(path, "utf8");

  // Two patterns, because JSON has no trailing commas and this entry's position
  // decides which comma has to go with it. Both use `[^\r\n]` rather than `.`:
  // this file is CRLF, and in JavaScript `.` does not match `\r`, so a pattern
  // ending `.*\n` silently never matches on Windows.
  const after = [
    // Followed by another script — take the line and its own trailing comma.
    /^[ \t]*"remove:test-env":[^\r\n]*,[ \t]*\r?\n/m,
    // Last in the object — take the PRECEDING comma instead, or the entry
    // before it is left dangling one and package.json stops parsing.
    /,([ \t]*\r?\n[ \t]*)"remove:test-env":[^\r\n]*/,
  ].reduce((text, pattern) => text.replace(pattern, ""), before);

  if (after === before) return false;

  try {
    JSON.parse(after);
  } catch {
    console.warn(
      "  ! package.json would not parse after edit — left alone. Remove the\n" +
        '    "remove:test-env" script by hand.'
    );
    return false;
  }

  writeFileSync(path, after);
  return true;
}

// ---------------------------------------------------------------------------

console.log("Removing the test environment...\n");

let changedFiles = 0;
let removedLines = 0;

for (const file of walk(ROOT)) {
  const result = strip(readFileSync(file, "utf8"));
  if (!result) continue;
  writeFileSync(file, result.text);
  changedFiles++;
  removedLines += result.removed;
  console.log(`  edited  ${relative(ROOT, file)} (-${result.removed} lines)`);
}

try {
  rmSync(TEST_ENV_DIR, { recursive: true });
  console.log(`  deleted ${relative(ROOT, TEST_ENV_DIR)}/`);
} catch {
  console.log(`  skipped ${relative(ROOT, TEST_ENV_DIR)}/ — already gone`);
}

if (cleanPackageJson()) console.log("  edited  package.json");

rmSync(SELF, { force: true });
console.log(`  deleted ${relative(ROOT, SELF)}`);

console.log(
  `\nDone — ${changedFiles} file(s), ${removedLines} line(s).\n\n` +
    "Next:\n" +
    "  1. npm run check           # must pass; it's the proof nothing dangled\n" +
    "  2. Remove SKYRUNNERS_TEST_ENV wherever it's set (Vercel, .env.local)\n" +
    "  3. Prune the prose by hand — markdown isn't scanned:\n" +
    "       docs/TWO_TRACK_DEPLOY.md, CLAUDE.md, docs/PHASE_PLAN.md\n" +
    "  4. git diff                # read it before committing\n"
);
