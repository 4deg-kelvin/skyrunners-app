/**
 * A member's own settings.
 *
 * Was "update schedule and academic pause", which was most of the page until
 * 2026-08-24. Both went with check-ins. What is left is the profile, the AI
 * connection, the calendar feed, and — for a Co-Lead — the academic calendar and
 * the trainings catalogue.
 */

import { clubIdentity, getMember, today, termFor } from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { emptyProjectsByCreator } from "@/lib/store/operations";
import { feedEventsFor } from "@/lib/calendar/window";
import type { Member, Term } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export interface SettingsView {
  member: Member;
  /** Where we are in the academic year right now. */
  currentTerm?: Term;
  /**
   * Whether obligations are being generated at all today. During finals and
   * breaks they aren't — worth saying plainly so nobody thinks the app is broken
   * when their update disappears over winter break.
   */
  inSession: boolean;
  /**
   * The whole calendar, soonest first, for the Co-Lead editor.
   *
   * Returned to everyone rather than gated here — the page decides what to
   * render, and knowing when the club is out of session is ordinary
   * information. Only *editing* is Co-Lead, and that's enforced in the action.
   */
  terms: Term[];
  /**
   * True once today falls past the end of every term on record.
   *
   * The single most likely way this feature rots: somebody enters the year's
   * calendar in September, it runs out in June, and from then on `termFor`
   * returns nothing — so `inSession` is false, no check-in is ever due again,
   * and the app looks like it simply stopped working. Worth saying out loud.
   */
  calendarRunsOut: boolean;
}

export async function getSettings(memberId: string): Promise<SettingsView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const member = getMember(memberId);
  if (!member) throw new Error(`Member not found: ${memberId}`);

  const currentTerm = termFor(today());

  const terms = [...readStore().terms].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn)
  );

  return {
    member,
    currentTerm,
    inSession: currentTerm?.generatesObligations ?? false,
    terms,
    calendarRunsOut:
      terms.length > 0 && terms[terms.length - 1].endsOn < today(),
  };
}

/*
  `getClubTiers()` used to live here, reading the four tier floors out of
  `club_settings` for the Settings editor and the published rubric. Both callers
  are gone — the tiers were removed on 2026-08-14 — so it went too rather than
  becoming a data function nothing calls, which `npm run sweep` would flag.

  The columns are still in Postgres. See `ClubSettings` in lib/types.ts.
*/

/** The club's own name and description, for the Co-Lead editor. */
export async function getClubIdentity(): Promise<{
  name: string;
  description: string;
  discordInviteUrl?: string;
}> {
  await preloadLiveStore();
  return clubIdentity();
}

// ---------------------------------------------------------------------------
// Cleaning up after a bulk write
// ---------------------------------------------------------------------------

export interface BulkCreationRow {
  memberId: string;
  fullName: string;
  /** Shells nobody else was ever added to. The safe group. */
  emptyCount: number;
  /**
   * Shells other people WERE added to — same emptiness test, weaker case.
   *
   * Counted apart and never folded into `emptyCount`, because a real project with
   * three people on it and no deliverable filed yet is indistinguishable from a
   * bulk-created one that happened to collect members. A Co-Lead decides on that
   * group separately.
   */
  withOthersCount: number;
  /** A few names, so a Co-Lead can see what they're about to remove. */
  sample: string[];
}

/**
 * Who has empty projects to their name, worst first.
 *
 * The dry run for the purge in Settings. Deliberately a REPORT rather than a
 * confirmation dialog: after ~4,000 projects were bulk-created through the MCP
 * server, the first question is not "delete?" but "how many, and whose", and a
 * count that appears before anything is pressed is the difference between a
 * cleanup and a leap.
 *
 * Only members with something to clean up are listed, so this is empty and
 * silent in the normal case. The threshold is deliberately low — three — because
 * a handful of stray test projects is worth offering to tidy, and hiding the
 * feature until a disaster happens means nobody knows it exists during one.
 */
export async function getBulkCreationReport(): Promise<BulkCreationRow[]> {
  await preloadLiveStore();
  const store = readStore();

  /*
    One pass for the whole club, then a lookup per member.

    Calling the per-creator selector in a loop was O(members x projects) and took
    4.7 seconds at this incident's scale — on the page opened to fix that very
    incident. See `emptyProjectsByCreator`.
  */
  const groups = emptyProjectsByCreator(store);

  return store.members
    .map((member) => {
      const alone = groups.alone.get(member.id) ?? [];
      const withOthers = groups.withOthers.get(member.id) ?? [];
      return {
        memberId: member.id,
        fullName: member.fullName,
        emptyCount: alone.length,
        withOthersCount: withOthers.length,
        // Sampled across both, so the names shown match what is actually there.
        sample: [...alone, ...withOthers].slice(0, 4).map((p) => p.name),
      };
    })
    .filter((row) => row.emptyCount + row.withOthersCount >= 3)
    .sort(
      (a, b) =>
        b.emptyCount + b.withOthersCount - (a.emptyCount + a.withOthersCount)
    );
}

/**
 * What this member's calendar app is being served, right now.
 *
 * ---------------------------------------------------------------------------
 * Why the app shows this at all
 * ---------------------------------------------------------------------------
 *
 * A calendar subscription has no error channel. When something is wrong the
 * member sees an empty calendar, which is indistinguishable from a club with
 * nothing scheduled — so "it isn't working" is unfalsifiable from either end, and
 * Anish lost two events to exactly that before anybody could say whether the
 * server or Apple was at fault.
 *
 * This turns that into a fact. If the event is listed here, the feed is serving
 * it and the problem is the calendar app; if it isn't, the problem is here.
 *
 * Uses `feedEventsFor`, the same selection the feed route uses, so it cannot
 * disagree with what is actually served — a preview with its own query would be
 * worse than none.
 */
export interface FeedPreviewRow {
  title: string;
  /** `YYYY-MM-DD`, already resolved in club time by the caller's formatter. */
  startsAt: string;
  repeats: boolean;
}

export async function getFeedPreview(
  memberId: string
): Promise<FeedPreviewRow[]> {
  await preloadLiveStore();
  return feedEventsFor(readStore().events, memberId).map((e) => ({
    title: e.title,
    startsAt: e.startsAt,
    repeats: Boolean(e.repeatUntil),
  }));
}
