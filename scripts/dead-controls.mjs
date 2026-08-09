/**
 * Find controls that exist but are never rendered.
 *
 * ---------------------------------------------------------------------------
 * Why this is a script and not a code review
 * ---------------------------------------------------------------------------
 *
 * This is the single most repeated bug in this project. Not "the logic is
 * wrong" — the logic was usually right, tested, and reachable from nowhere:
 *
 *   - `deleteWorkLog` + `deleteHoursAction` shipped with no row to hang the
 *     button on, so a mistyped `80` instead of `8.0` was permanent.
 *   - `reopenHelpRequestAction` shipped with `ReopenButton` written and never
 *     imported, making "Mark sorted" a one-way door.
 *   - `updateEventAction` shipped with no edit form, so the only way to move a
 *     session by an hour was to cancel it — which deletes the attendee list.
 *
 * Every one of those typechecks, lints, and passes its unit tests. Nothing in
 * the toolchain notices, because an unused export is a perfectly legal export.
 * The symptom only ever appears to a human clicking around, and it reads as
 * "the feature wasn't built" rather than "the feature has no door".
 *
 * So: three passes, each with its own rule for what counts as reachable.
 *
 *   ACTIONS      must be referenced from `app/` or `components/`. A server
 *                action reachable only from another action is not a control.
 *   COMPONENTS   must be referenced from some file — including their own,
 *                since a subcomponent used only by its sibling is fine.
 *   DATA         must be referenced from some OTHER file. `lib/data/*` is a
 *                boundary for pages; a function nothing reads is dead weight
 *                that will drift out of sync with the schema.
 *
 * Exits non-zero on a finding, and runs as part of `npm run check`. Anything
 * deliberately unexported-but-kept needs a `// dead-controls: allow <why>`
 * comment on the line above, which is a decision somebody has to write down.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SEARCH_DIRS = ["app", "components", "lib", "scripts"];

/** Every source file we might reference a symbol from. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SEARCH_DIRS.flatMap((d) => walk(join(ROOT, d)));
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** Exported function/const names in a file, with the line they're declared on. */
function exportsOf(file) {
  const text = sources.get(file) ?? "";
  const lines = text.split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    const m = line.match(
      /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/
    );
    if (!m) return;
    // An explicit opt-out, so keeping something has to be a written decision.
    if ((lines[i - 1] ?? "").includes("dead-controls: allow")) return;
    found.push({ name: m[1], line: i + 1 });
  });
  return found;
}

/**
 * Does `name` appear in `file` anywhere other than its own declaration?
 *
 * Word-boundary match rather than an import parse: a symbol can arrive through
 * a namespace import, a re-export, or `ops.foo`, and every one of those counts
 * as reachable. False negatives here are safe; false positives are noise that
 * would get the whole script switched off.
 */
function referencedIn(file, name, declaringFile, declLine) {
  const text = sources.get(file);
  if (!text) return false;
  const pattern = new RegExp(`\\b${name}\\b`);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (file === declaringFile && i + 1 === declLine) continue;
    if (pattern.test(lines[i])) return true;
  }
  return false;
}

const findings = [];

function sweep({ label, from, rule, skipOwnFile, only }) {
  for (const file of from) {
    for (const { name, line } of exportsOf(file)) {
      if (only && !only(name, file)) continue;
      const candidates = files.filter((f) => {
        if (skipOwnFile && f === file) return false;
        return rule(f);
      });
      const live = candidates.some((f) => referencedIn(f, name, file, line));
      if (!live) {
        findings.push({
          label,
          name,
          where: `${relative(ROOT, file)}:${line}`,
        });
      }
    }
  }
}

const under =
  (...dirs) =>
  (f) =>
    dirs.some((d) => relative(ROOT, f).replace(/\\/g, "/").startsWith(`${d}/`));

// --- 1. Server actions nothing renders -------------------------------------
sweep({
  label: "action never rendered",
  from: files.filter(
    (f) => relative(ROOT, f).replace(/\\/g, "/") === "lib/actions/index.ts"
  ),
  only: (name) => name.endsWith("Action"),
  rule: under("app", "components"),
  skipOwnFile: true,
});

// --- 2. Components nothing mounts ------------------------------------------
sweep({
  label: "component never mounted",
  from: files.filter((f) => under("components")(f) && f.endsWith(".tsx")),
  rule: under("app", "components"),
  skipOwnFile: false,
});

// --- 3. Data functions nothing calls ---------------------------------------
sweep({
  label: "data function never called",
  from: files.filter(
    (f) =>
      under("lib")(f) &&
      relative(ROOT, f).replace(/\\/g, "/").startsWith("lib/data/") &&
      !f.endsWith(".test.ts")
  ),
  rule: () => true,
  skipOwnFile: true,
});

if (findings.length === 0) {
  console.log("dead-controls: nothing unreachable.");
  process.exit(0);
}

console.error(
  `\ndead-controls found ${findings.length} unreachable export(s):\n`
);
for (const f of findings) {
  console.error(`  ${f.label.padEnd(28)} ${f.name}`);
  console.error(`  ${" ".repeat(28)} ${f.where}\n`);
}
console.error(
  "Either render it, call it, delete it, or add `// dead-controls: allow <why>`\n" +
    "on the line above the export.\n"
);
process.exit(1);
