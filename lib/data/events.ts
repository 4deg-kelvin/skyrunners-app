/**
 * Calendar events.
 *
 * PHASE 1 NOTE: sort and filter in SQL (`ORDER BY starts_at`, plus a
 * `starts_at >= now()` predicate), not in JavaScript. Pulling every event the
 * club has ever held and sorting client-side stops working after a year.
 */

import { readStore } from "@/lib/store/disk";
import type { ClubEvent } from "@/lib/types";
import { preloadLiveStore } from "@/lib/store/request";

export async function getUpcomingEvents(): Promise<ClubEvent[]> {
  // Ensure the live snapshot exists before any synchronous read.
  //
  // Idempotent and free once loaded. It's here rather than left to the caller
  // because pages legitimately do `Promise.all([getRoster(), getViewer()])` —
  // which starts the read BEFORE getViewer has preloaded, and every such page
  // then died on "Live store not loaded". Guarding at the boundary means call
  // order stops mattering.
  await preloadLiveStore();
  return [...readStore().events].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt)
  );
}
