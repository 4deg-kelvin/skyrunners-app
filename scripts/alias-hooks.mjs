/**
 * Resolver hook so plain Node can load the app's modules.
 *
 * Next resolves two things automatically that Node does not:
 *
 *   1. the `@/…` path alias from tsconfig
 *   2. extensionless imports — `./disk` meaning `./disk.ts`
 *
 * Both are used throughout `lib/data/*` and `lib/store/*`, so a script that
 * wants to exercise the real data layer needs both. (`lib/store/*` and the test
 * suite use explicit `.ts` extensions precisely to avoid needing this; the rest
 * of the app doesn't, because Next handles it.)
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

/** Tried in order. The empty string first, so exact paths win. */
const CANDIDATES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExisting(base) {
  for (const ext of CANDIDATES) {
    const candidate = new URL(base.href + ext);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  // `@/…` → project root.
  if (specifier.startsWith("@/")) {
    const found = firstExisting(new URL(specifier.slice(2), ROOT));
    if (found) return next(found, context);
  }

  // Relative imports missing an extension.
  if (specifier.startsWith(".") && context.parentURL) {
    const found = firstExisting(new URL(specifier, context.parentURL));
    if (found) return next(found, context);
  }

  // Bare specifiers into packages that ship ESM without extensionless exports —
  // `next/headers` resolves only as `next/headers.js` outside Next's own
  // bundler. Try the plain form first so nothing else changes behaviour.
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") || specifier.startsWith("@/")) throw error;
    return next(`${specifier}.js`, context);
  }
}
