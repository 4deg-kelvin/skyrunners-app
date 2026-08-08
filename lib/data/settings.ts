/**
 * A member's own settings: update schedule and academic pause.
 *
 * PHASE 1b: these become one select and one update against `update_schedules`.
 */

import { getMember, scheduleFor, today, termFor } from "@/lib/mock-data";
import { UPDATES_PER_WEEK_DEFAULT, type Member, type Term } from "@/lib/types";

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
