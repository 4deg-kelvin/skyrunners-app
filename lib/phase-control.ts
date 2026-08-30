/**
 * What the inline phase control offers, as pure functions.
 *
 * The control itself is a Client Component whose popover only exists after
 * hydration, which means fetching a project page cannot tell you what the list
 * says. These rules therefore live here rather than inline in the JSX — the
 * same reasoning as `lib/quiet.ts`: the part with the judgment in it should be
 * testable without a browser.
 *
 * Two rules, and both have a permission behind them:
 *
 *   - Crossing INTO `complete` needs `can.completeProject`, which excludes the
 *     project's own PL, AND every sub-project already finished.
 *   - Everything else needs `can.manageProject`, which the caller has already
 *     checked before rendering the control at all.
 *
 * Neither is enforced here. `setProjectPhaseAction` re-checks the permission
 * and `ops.updateProject` re-checks the descendants, because a disabled button
 * is a hint and not a guard.
 */

import { PHASE_ORDER } from "@/lib/labels";
import type { ProjectPhase } from "@/lib/types";

export interface PhaseOptions {
  /** The next phase forward, if there is one and it is offerable. */
  advanceTo?: ProjectPhase;
  /** Whether the list may offer `complete`. */
  mayComplete: boolean;
  /** Why not, when it may not. Empty when it may. */
  blockedReason: string;
}

export function phaseOptions(input: {
  phase: ProjectPhase;
  /** Does this viewer hold `can.completeProject` for the project? */
  canComplete: boolean;
  /** Names of sub-projects that are not finished. */
  incompleteDescendants: string[];
}): PhaseOptions {
  const index = PHASE_ORDER.indexOf(input.phase);
  const next = index >= 0 ? PHASE_ORDER[index + 1] : undefined;

  const blockedByChildren = input.incompleteDescendants.length > 0;
  const mayComplete = input.canComplete && !blockedByChildren;

  /*
    The advance button is withheld when the next step is `complete` and this
    person is not the one who agrees it. Offering it and refusing the click
    would be worse than not offering it: the refusal names somebody else, so
    the button is an invitation to fail.
  */
  const advanceTo =
    next && (next !== "complete" || mayComplete) ? next : undefined;

  return { advanceTo, mayComplete, blockedReason: blockedReason(input) };
}

/**
 * Why `complete` is unavailable, worded so it names the fix.
 *
 * The descendant rule comes FIRST when both apply. It is the one the reader can
 * act on — go and finish those — whereas "ask somebody else" is a dead end if
 * the children are still open anyway.
 */
export function blockedReason(input: {
  canComplete: boolean;
  incompleteDescendants: string[];
}): string {
  const names = input.incompleteDescendants;

  if (names.length > 0) {
    const listed = names.slice(0, 2).join(" and ");
    const more = names.length > 2 ? ` and ${names.length - 2} more` : "";
    return `Finish ${listed}${more} first \u2014 a project can't finish ahead of its own sub-projects.`;
  }

  if (!input.canComplete) {
    return "Only a PL above this project, or its Division Lead, can agree it's done. Tell them it's ready.";
  }

  return "";
}
