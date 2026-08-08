/**
 * The personas the switcher offers.
 *
 * Not "one of each role" — these are chosen to exercise the parts of
 * `lib/permissions.ts` that actually break. The module has two inheritances
 * running in OPPOSITE directions (RE authority flows down the project tree, Lead
 * authority flows up the reporting chain), and every persona below sits at a
 * different place in that crossing.
 *
 * Ordered leadership-first, because that's the order you'll want when checking a
 * change: build as the Co-Lead, then drop to a plain member and confirm you
 * haven't leaked anything.
 *
 * `id` must be a real member in `lib/mock-data.ts`. `personas.test.ts` asserts
 * that, and asserts `expectedRole` still matches — so renaming or re-roling a
 * mock member fails the test suite instead of silently showing you the wrong
 * person.
 */

// Relative, with the extension, matching the rest of `lib/` — these files have
// to be importable by `node --experimental-strip-types`, which doesn't resolve
// the `@/` alias.
import type { GlobalRole } from "../types.ts";

export interface TestPersona {
  /** Member id in `lib/mock-data.ts`. */
  id: string;
  /** Short label for the switcher button. */
  label: string;
  /** Asserted against mock data by the test — drift fails CI, not silently. */
  expectedRole: GlobalRole;
  /** What this persona is for. Shown in the switcher, so it's read, not lost. */
  exercises: string;
}

export const TEST_PERSONAS: TestPersona[] = [
  {
    id: "m-anish",
    label: "Co-Lead",
    expectedRole: "co_lead",
    exercises:
      "Answers yes to every permission question. Sees the Dashboard, every project, and everyone's effort data. If something is hidden from this persona, it's a bug.",
  },
  {
    id: "m-priya",
    label: "Team Lead (top of a chain)",
    expectedRole: "lead",
    exercises:
      "Leads Dev, who leads Sofia and Noah — so Priya oversees people two levels down, not just her directs. Also RE of the eVTOL Airframe. The clearest test of Lead authority inheriting UP a chain.",
  },
  {
    id: "m-dev",
    label: "Team Lead (mid-chain, no RE role)",
    expectedRole: "lead",
    exercises:
      "Reports to Priya and leads two members, but is RE of nothing. Proves Lead and RE are separate: he can see his reports' hours yet cannot manage any project's deliverables.",
  },
  {
    id: "m-tyler",
    label: "Member who is an RE",
    expectedRole: "member",
    exercises:
      "globalRole is `member`, but he's the RE of Wing Spar Redesign. This is the persona that catches any `if (globalRole === ...)` written inline instead of going through lib/permissions.ts.",
  },
  {
    id: "m-sofia",
    label: "Member, deepest chain",
    expectedRole: "member",
    exercises:
      "Sofia → Dev → Priya → Anish, four levels. No Dashboard in her nav. Use this one to check what a normal new member actually sees on their first login.",
  },
  {
    id: "m-grace",
    label: "Member, no division",
    expectedRole: "member",
    exercises:
      "`primaryTeamId` is unset and she's a non-primary RE on the workshop series. Shakes out anything that groups by team id directly instead of resolving the division.",
  },
];

/**
 * Sentinel for "stop overriding, go back to `CURRENT_USER_ID`".
 *
 * Lives here rather than next to the action that consumes it because a
 * `"use server"` module may only export async functions — a plain `const` in
 * `actions.ts` fails the build with an error that points at the constant and
 * says nothing about the rule. Don't move it back.
 */
export const RESET_VALUE = "__default";

const PERSONA_IDS: ReadonlySet<string> = new Set(TEST_PERSONAS.map((p) => p.id));

/** Allowlist check. The cookie is user-editable, so ids are never trusted. */
export function isKnownPersonaId(id: string | undefined): boolean {
  return typeof id === "string" && PERSONA_IDS.has(id);
}
