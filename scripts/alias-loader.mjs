/**
 * Register the `@/…` resolver so plain Node can load `lib/data/*`.
 *
 *   node --import ./scripts/alias-loader.mjs --experimental-strip-types x.ts
 *
 * Next understands the tsconfig path alias and extensionless imports; Node
 * understands neither. This is what lets a script exercise the real data layer
 * against the real database — the difference between "it compiles" and "every
 * page's data function actually works on production data".
 */

import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
