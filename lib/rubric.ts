/**
 * What leadership looks for, published to members at `/how-we-lead`.
 *
 * ---------------------------------------------------------------------------
 * Why it is published at all
 * ---------------------------------------------------------------------------
 *
 * Unchanged from when this lived in `lib/contribution.ts`, and it is the reason
 * the list exists rather than sitting in a Co-Lead's head: a rubric that decides
 * advancement but stays hidden is a performance review with a concealed scale.
 * When it leaks, the trust cost is retroactive — it recolors every update the
 * person ever wrote.
 *
 * ---------------------------------------------------------------------------
 * Rewritten on 2026-08-24, not trimmed
 * ---------------------------------------------------------------------------
 *
 * Two of the four rows were about check-ins, which the club stopped filing.
 * Deleting them would have left the list saying less than the club means.
 *
 * "Reliability — updates in on time" is replaced by **Visible**. That is not a
 * rename: the club's answer to "how does anyone know what you did" is now the
 * work log on the project, which is public and which a PL can reply to. It is
 * the same virtue (people can depend on knowing where you are) measured on the
 * thing that still exists.
 *
 * "Sustained over a quarter" keeps its row and loses its check-in clause. It is
 * the criterion nothing else covers — one heroic week reading the same as a
 * quarter of steady work — so it is stated against deliverables finished in
 * several different weeks.
 *
 * Ordered. Earlier criteria dominate.
 */
export const LEADERSHIP_RUBRIC = [
  {
    signal: "Delivered",
    what: "Deliverables finished and projects carried to completion",
    why: "Finished work is the only signal that can't be faked. This dominates everything below it.",
  },
  {
    signal: "Sustained over a quarter",
    what: "Work finished in several different weeks, not all in one push",
    why: "Leading requires showing up late in the quarter, not just at the start. Spread over time is the part one heroic week can't fake.",
  },
  {
    signal: "Visible",
    what: "Work logged on the project as you go, and blockers raised early rather than discovered late",
    why: "A PL can only help with what they can see. Logging as you go is how the rest of the club knows where a project stands without asking.",
  },
  {
    signal: "Lifting others",
    what: "Answering blockers, signing off work, onboarding new members",
    why: "The job is making other people effective, which is different from being effective yourself.",
  },
] as const;

/**
 * Deliberately NOT provided: any function that ranks members against each other.
 *
 * The data supports it and it would be a few lines. It's absent because the
 * moment a ranking exists in the UI, these signals stop being a description of
 * someone's work and become a target to optimize. Leadership reads them next to
 * a member's actual projects, where they can be interpreted rather than merely
 * compared.
 */
