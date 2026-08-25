/**
 * How much somebody has finished. Two counts, and deliberately nothing else.
 *
 * ---------------------------------------------------------------------------
 * What this replaced, and why it is so much smaller
 * ---------------------------------------------------------------------------
 *
 * `lib/contribution.ts` reported three independent signals — Delivered,
 * Reliability and Scope — with a hard rule against combining them into a score.
 * That rule held. What did not survive was Reliability, because it measured
 * check-ins filed on time and the club stopped filing check-ins on 2026-08-24.
 *
 * The club's answer was not "redefine it". It was: delete reliability, keep a
 * plain counter of what somebody finished, and put it in the side column of
 * their profile next to the other details rather than in a panel of its own.
 * So this module is two numbers.
 *
 * Scope — how many PL roles somebody holds — went with it. It was always
 * reported and never blended in, for the reason recorded in the old file: it
 * requires having already been appointed, so it measures having already been
 * chosen. Once the panel around it was gone there was nowhere honest to put a
 * number that means "somebody picked this person".
 *
 * ---------------------------------------------------------------------------
 * Rules that came across intact
 * ---------------------------------------------------------------------------
 *
 * **No composite, no ranking, no rate.** Two counts of things that happened.
 * A percentage needs a denominator, and every available denominator here is a
 * judgment: deliverables assigned depends on a PL's granularity, and projects
 * joined depends on who invited you.
 *
 * **Never add a third count built on volume.** Days logged, entries written,
 * sessions attended — each is the hours signal in new clothes, inflatable by
 * anybody willing to log more finely. `lib/delivered.test.ts` fails on those
 * field names, which is the same guard `lib/contribution.test.ts` carried.
 *
 * **Public.** Everything about a member is public as of 2026-08-24, so there is
 * no permission rule guarding this and there should not be one. Two counts of
 * finished work are the least sensitive thing on the page.
 */

export interface Delivered {
  /** Deliverables of theirs that a PL signed off. */
  deliverablesCompleted: number;
  /**
   * Projects they were COMMITTED to that reached `complete`.
   *
   * Committed, not following — membership is PL-controlled and nobody adds
   * themselves, so this cannot be self-inflated. It deliberately does NOT
   * require them to have owned a deliverable on it: the old rule did, which
   * scored the PL who carried a project to the finish at zero whenever the work
   * was tracked as other people's deliverables. That is the person most
   * responsible for it finishing.
   */
  projectsCompleted: number;
}

export interface DeliveredInputs {
  deliverablesCompleted: number;
  projectsCompleted: number;
}

export function buildDelivered(i: DeliveredInputs): Delivered {
  return {
    deliverablesCompleted: i.deliverablesCompleted,
    projectsCompleted: i.projectsCompleted,
  };
}
