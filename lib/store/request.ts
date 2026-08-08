/**
 * Per-request live store.
 *
 * `readStore()` is synchronous — it has to be, because `OrgGraph`'s lookups are
 * called in loops while walking the org and project trees, and making them
 * async would turn one permission check into fifty round trips.
 *
 * So the whole database is loaded ONCE per request, up front, and every
 * synchronous read is served from that snapshot.
 *
 * The snapshot is held inside React's `cache()`, which is request-scoped. A
 * module-level variable would be shared between concurrent users on the same
 * server instance — one person's unsaved write would appear inside another
 * person's page render. That's the bug this file exists to prevent.
 */

import { cache } from "react";

import { installLiveBackend, type StoreShape } from "./disk";
import { loadSnapshot, persistDiff, snapshotCopy } from "./supabase";
import { createClient } from "@/lib/supabase/server";
import { isLiveMode } from "@/lib/env";

interface Holder {
  /** What operations read and mutate. */
  snapshot: StoreShape | null;
  /** An untouched copy, so a write can be diffed against where it started. */
  original: StoreShape | null;
}

/**
 * One holder per request. `cache()` guarantees the same object for every caller
 * within a request and a fresh one for the next.
 */
const holder = cache((): Holder => ({ snapshot: null, original: null }));

/**
 * Load the database for this request.
 *
 * Called from `getViewer()`, which every page and every Server Action already
 * goes through — so there's exactly one place to remember, and it's a place
 * nothing can render without.
 *
 * A no-op in demo mode, and a no-op if already loaded, so calling it repeatedly
 * within a request costs nothing.
 */
export async function preloadLiveStore(): Promise<void> {
  if (!isLiveMode()) return;

  const h = holder();
  if (h.snapshot) return;

  const supabase = await createClient();
  if (!supabase) return;

  const loaded = await loadSnapshot(supabase);
  h.snapshot = loaded;
  h.original = snapshotCopy(loaded);
}

installLiveBackend(
  () => holder().snapshot,
  async (mutated) => {
    const h = holder();
    const supabase = await createClient();
    if (!supabase || !h.original) return;

    await persistDiff(supabase, h.original, mutated);
    // The written state becomes the new baseline, so a second write in the
    // same request diffs against what's actually in the database rather than
    // re-sending the first write's changes.
    h.original = snapshotCopy(mutated);
  }
);
