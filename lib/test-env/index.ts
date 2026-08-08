/**
 * Test environment — read side.
 *
 * `lib/data/viewer.ts` calls `readTestPersonaId()` to decide who the demo viewer
 * is. Everything else in the app is untouched and unaware.
 */

import { cookies } from "next/headers";

import { isTestEnvEnabled } from "@/lib/env";
import { isKnownPersonaId } from "./personas";

export { TEST_PERSONAS, isKnownPersonaId, RESET_VALUE } from "./personas";
export type { TestPersona } from "./personas";

export const TEST_PERSONA_COOKIE = "sr_test_persona";

/**
 * The persona currently selected, or null.
 *
 * The `isTestEnvEnabled()` check comes FIRST, before `cookies()`, and that
 * ordering is load-bearing rather than tidy. Reading `cookies()` opts a route out
 * of static rendering in the App Router — so calling it unconditionally would
 * change how every page in the app renders, in production, for a feature that
 * isn't even switched on there. Returning early keeps production byte-identical
 * to a repo with none of this in it.
 *
 * The cookie is httpOnly but still ultimately user-controlled, so the value is
 * checked against the persona allowlist rather than passed to `getMember()` as
 * given.
 */
export async function readTestPersonaId(): Promise<string | null> {
  if (!isTestEnvEnabled()) return null;

  const value = (await cookies()).get(TEST_PERSONA_COOKIE)?.value;
  return isKnownPersonaId(value) ? (value as string) : null;
}
