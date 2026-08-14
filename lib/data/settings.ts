/**
 * A member's own settings: update schedule and academic pause.
 *
 * PHASE 1b: these become one select and one update against `update_schedules`.
 */

import {
  clubIdentity,
  getMember,
  scheduleFor,
  today,
  termFor,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { UPDATES_PER_WEEK_DEFAULT, type Member, type Term } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export interface SettingsView {
  member: Member;
  schedule: {
    updatesPerWeek: number;
    weekdays: number[];
    dueTime: string;
    pausedUntil?: string;
  };
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

  const schedule = scheduleFor(memberId);
  const currentTerm = termFor(today());

  const terms = [...readStore().terms].sort((a, b) =>
    a.startsOn.localeCompare(b.startsOn)
  );

  return {
    member,
    schedule: {
      updatesPerWeek: schedule?.updatesPerWeek ?? UPDATES_PER_WEEK_DEFAULT,
      weekdays: schedule?.weekdays ?? [1, 4],
      dueTime: schedule?.dueTime ?? "23:59",
      pausedUntil: schedule?.pausedUntil,
    },
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
