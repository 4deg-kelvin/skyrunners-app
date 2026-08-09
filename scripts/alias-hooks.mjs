/**
 * Resolver hook: `@/…` → project root, and add the extension Node needs.
 *
 * Next resolves both of these for you. Plain Node does neither, so anything
 * importing `@/lib/data/my-work` fails twice over — unknown package, then
 * missing extension.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);

/** Extensionless imports are the norm in `lib/data/*`; try the real files. */
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);

  const base = new URL(specifier.slice(2), ROOT);
  for (const ext of CANDIDATES) {
    const candidate = new URL(base.href + ext);
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate.href, context);
    }
  }
  // Let Node produce its own error rather than inventing one.
  return next(pathToFileURL(fileURLToPath(base)).href, context);
}
