/**
 * A member's own settings: update schedule and academic pause.
 *
 * PHASE 1b: these become one select and one update against `update_schedules`.
 */

import { getMember, scheduleFor, today, termFor } from "@/lib/mock-data";
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
  };
}
