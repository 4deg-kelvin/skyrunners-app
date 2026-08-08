"use server";

/**
 * Test environment — write side. One action: change who you're browsing as.
 */

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { isTestEnvEnabled } from "@/lib/env";
import { isKnownPersonaId, RESET_VALUE } from "./personas";
import { TEST_PERSONA_COOKIE } from "./index";

/**
 * Server Actions are reachable by POST from anywhere the moment they exist —
 * being rendered by a hidden component is not access control. So this re-checks
 * the flag itself rather than trusting that the bar wasn't shown.
 *
 * With the demo-mode interlock in `isTestEnvEnabled()`, that makes this action
 * inert in production even if someone finds its endpoint.
 */
/**
 * `personaId` arrives via `.bind()`, NOT as a form field.
 *
 * The obvious design — one form, six `<button name="personaId" value={id}>` —
 * does not work. React uses a submitting button's `name`/`value` to encode which
 * Server Action to invoke, so it overwrites anything you put there, and the
 * action receives the wrong id. It warns at runtime and nowhere else: the build
 * and typecheck both pass.
 *
 *     Cannot specify a "name" prop for a button that specifies a function as a
 *     formAction. React needs it to encode which action should be invoked.
 *
 * Binding the id into a distinct action per button is the supported way to do
 * this, and it's why each button gets its own `formAction`.
 */
export async function switchPersona(personaId: string, _formData: FormData) {
  if (!isTestEnvEnabled()) return;

  const requested = personaId;
  const store = await cookies();

  if (requested === RESET_VALUE) {
    store.delete(TEST_PERSONA_COOKIE);
  } else if (isKnownPersonaId(requested)) {
    store.set(TEST_PERSONA_COOKIE, requested, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // A month. Long enough to survive a week of development, short enough
      // that a forgotten cookie doesn't confuse you next term.
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    // Unknown id — a stale cookie from a persona that's since been renamed, or
    // someone poking at the endpoint. Do nothing rather than guess.
    return;
  }

  // Persona changes what every page renders, not just this one, so the whole
  // layout tree has to be invalidated — a plain `revalidatePath("/")` would
  // leave the nav (and its Dashboard link) showing the previous persona's.
  revalidatePath("/", "layout");
}
