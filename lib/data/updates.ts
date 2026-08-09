/**
 * The check-ins page, in one call.
 *
 * Two audiences on one page, and the split is the privacy model made concrete:
 *
 *   YOUR OWN history — everything, because it's yours.
 *   YOUR REPORTS' check-ins — only people who report to you, and only because
 *   reading them is your named obligation.
 *
 * Nobody else's personal report appears here under any circumstances. An RE with
 * no reports sees only their own history, which is correct: they get the
 * per-project half of everyone's update publicly, on the project page.
 */

import {
  getMember,
  getProject,
  today,
} from "@/lib/mock-data";
import { readStore } from "@/lib/store/disk";
import { isCoLead, type Actor } from "@/lib/permissions";
import {
  REVIEW_GRACE_DAYS,
  unreadReportsFor,
  reviewRecordFor,
} from "@/lib/review";
import type { Member, Project, ProgressUpdate, UpdateEntry } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export interface UpdateCard {
  update: ProgressUpdate;
  author?: Member;
  /** Entries paired with their project, so the UI never looks anything up. */
  sections: { entry: UpdateEntry; project?: Project }[];
  ageDays: number;
  escalated: boolean;
}

export interface UpdatesView {
  /** The viewer's own check-ins, newest first. */
  mine: UpdateCard[];
  /** Check-ins written to the viewer that they haven't read. Oldest first. */
  toReview: UpdateCard[];
  /** Ones they've already read, so the page shows progress, not just debt. */
  reviewed: UpdateCard[];
  /** How the viewer is doing at their own reviewing obligation. */
  record: { unread: number; escalated: number; worstAgeDays: number };
  /** True when the viewer has reports — decides whether the queue renders. */
  isReviewer: boolean;
  graceDays: number;
  today: string;
}

function sectionsFor(update: ProgressUpdate) {
  return update.entries.map((entry) => ({
    entry,
    project: getProject(entry.projectId),
  }));
}

function daysSince(iso: string | undefined, today: string): number {
  if (!iso) return 0;
  const from = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

export async function getUpdates(actor: Actor): Promise<UpdatesView> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  const { progressUpdates } = readStore();

  const mine: UpdateCard[] = progressUpdates
    .filter((u) => u.memberId === actor.id)
    .map((update) => ({
      update,
      author: getMember(update.memberId),
      sections: sectionsFor(update),
      ageDays: daysSince(update.submittedAt ?? update.dueAt, today()),
      escalated: false,
    }))
    .sort((a, b) => (a.update.dueAt < b.update.dueAt ? 1 : -1));

  // Direct reports only. A Co-Lead is somebody's Lead too — they don't inherit
  // every report in the club here, or the queue becomes the unusable club-wide
  // list the dashboard rework existed to kill.
  const directReports = readStore().members.filter(
    (m) => m.leadId === actor.id && m.status === "active"
  );

  const toReview: UpdateCard[] = unreadReportsFor(
    actor.id,
    progressUpdates,
    directReports,
    today()
  ).map((r) => ({
    update: r.update,
    author: r.author,
    sections: sectionsFor(r.update),
    ageDays: r.ageDays,
    escalated: r.escalated,
  }));

  const reportIds = new Set(directReports.map((m) => m.id));
  const reviewed: UpdateCard[] = progressUpdates
    .filter((u) => u.status === "reviewed" && reportIds.has(u.memberId))
    .map((update) => ({
      update,
      author: getMember(update.memberId),
      sections: sectionsFor(update),
      ageDays: daysSince(update.submittedAt ?? update.dueAt, today()),
      escalated: false,
    }))
    .sort((a, b) => (a.update.dueAt < b.update.dueAt ? 1 : -1));

  return {
    mine,
    toReview,
    reviewed,
    record: reviewRecordFor(actor.id, progressUpdates, directReports, today()),
    // Co-Leads see the section even with no direct reports, because they still
    // need to know the mechanism exists.
    isReviewer: directReports.length > 0 || isCoLead(actor),
    graceDays: REVIEW_GRACE_DAYS,
    today: today(),
  };
}
