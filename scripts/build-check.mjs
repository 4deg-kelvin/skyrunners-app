#!/usr/bin/env node
/**
 * Verify the app builds — WITHOUT touching a running dev server.
 *
 *   npm run build:check
 *
 * `next build` deletes and rewrites its output directory. `next dev` serves live
 * out of that same directory. Running the two together rips the dev server's
 * webpack chunks out from under it, and it does not recover:
 *
 *     Cannot find module './405.js'
 *     __webpack_modules__[moduleId] is not a function
 *     ENOENT: .next/server/pages-manifest.json
 *
 * Those read like application bugs. They aren't — they're a build and a dev
 * server sharing one directory. Recovery is stopping the server, deleting
 * `.next`, and restarting.
 *
 * This script points the build at `.next-build` instead (see `distDir` in
 * next.config.ts), so it's always safe to run. Use it for every "does it still
 * compile?" check. Plain `npm run build` stays exactly as Vercel and CI run it.
 *
 * Done as a script rather than an inline env var because `FOO=bar cmd` isn't
 * valid in cmd.exe or PowerShell, and this repo is developed on Windows —
 * the alternative was adding `cross-env` as a dependency for one line.
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const DIST = ".next-build";

/**
 * `next build` rewrites tsconfig.json — it reformats the whole file and adds an
 * include for its own generated types. Harmless, but with a non-default distDir
 * it adds `.next-build/types`, so every verification build would leave the
 * working tree dirty with a diff nobody asked for.
 *
 * Snapshot it, restore it afterwards. A script that checks something should not
 * change anything.
 */
const TSCONFIG = "tsconfig.json";
const tsconfigBefore = readFileSync(TSCONFIG, "utf8");

console.log(`Building into ${DIST}/ (leaving .next alone)…\n`);

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: DIST },
  // Required on Windows: npx is a .cmd shim, not an executable.
  shell: true,
});

if (readFileSync(TSCONFIG, "utf8") !== tsconfigBefore) {
  writeFileSync(TSCONFIG, tsconfigBefore);
}

if (result.status !== 0) {
  console.error("\nBuild failed.");
  process.exit(result.status ?? 1);
}

console.log(
  `\nBuild OK. Output in ${DIST}/ — safe to delete, and gitignored.\n` +
    "Your dev server was not touched."
);
