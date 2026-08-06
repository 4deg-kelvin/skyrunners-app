/**
 * Calendar events.
 *
 * PHASE 1 NOTE: sort and filter in SQL (`ORDER BY starts_at`, plus a
 * `starts_at >= now()` predicate), not in JavaScript. Pulling every event the
 * club has ever held and sorting client-side stops working after a year.
 */

import { events } from "@/lib/mock-data";
import type { ClubEvent } from "@/lib/types";

export async function getUpcomingEvents(): Promise<ClubEvent[]> {
  return [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
