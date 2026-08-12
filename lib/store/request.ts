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

import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

import { hasLiveSnapshot, installLiveBackend, type StoreShape } from "./disk";
import { loadSnapshot, persistDiff, snapshotCopy } from "./supabase";
import { createClient } from "@/lib/supabase/server";
import { isLiveMode } from "@/lib/env";

/** The Supabase client shape both the loader and the writer need. */
type StoreClient = Awaited<ReturnType<typeof createClient>>;

interface Holder {
  /** What operations read and mutate. */
  snapshot: StoreShape | null;
  /** An untouched copy, so a write can be diffed against where it started. */
  original: StoreShape | null;
  /**
   * A client supplied by the caller instead of resolved from cookies.
   *
   * Only the MCP server sets this. Everything else leaves it null and gets
   * `createClient()`, which reads the session cookie.
   *
   * It has to live on the holder rather than being passed down, because the
   * WRITER also needs it: `installLiveBackend` is registered once at module
   * scope and called much later, from inside `mutate()`, with no way to reach
   * whatever opened the request. Before this, an MCP write would call
   * `createClient()` with no cookies, get null, and `return` — a silent no-op
   * reporting success, which is the exact failure shape this file's header
   * warns about.
   */
  client: StoreClient;
}

/**
 * One holder per request — in renders AND in Server Actions.
 *
 * `cache()` alone is not enough, and this is the bug that made every write fail
 * while every page read fine. React memoizes a cached function for the duration
 * of a RENDER. A Server Action doesn't run inside one, so `cache()` there hands
 * back a brand-new object on every call: `getViewer()` loaded the database into
 * one throwaway holder, and the write that followed asked a second, empty one.
 * Reads worked because pages do run inside a render.
 *
 * So the holder is anchored to the async execution context instead, which both
 * a render and an action have. `enterWith` is what makes that possible without
 * wrapping every action — it binds the store for the rest of the current
 * context, so a callee can establish the scope its caller will keep seeing.
 *
 * Still one per request: concurrent requests are separate context trees, so
 * nobody sees anybody else's unsaved writes — the property this file exists
 * for. The `cache()` call is kept as the seed so the render path is unchanged.
 */
const store = new AsyncLocalStorage<Holder>();
const cachedHolder = cache((): Holder => ({
  snapshot: null,
  original: null,
  client: null,
}));

function holder(): Holder {
  return store.getStore() ?? cachedHolder();
}

/**
 * Give a Server Action its own request scope.
 *
 * EVERY action must be wrapped in this, and `lib/actions/index.ts` does it in
 * one place at the bottom of the file so it can't be forgotten per-action.
 *
 * Why a wrapper rather than something automatic: the scope has to be opened
 * around the WHOLE action, by the action itself. An earlier attempt had
 * `preloadLiveStore()` open it from the inside with `enterWith`, which looked
 * tidier and did not work — after `await preloadLiveStore()` the caller resumes
 * in the async context captured at its own `await`, which predates the scope.
 * The store vanished between loading it and using it, which is precisely the
 * bug this is fixing. A callee cannot reliably hand a scope back to its caller;
 * only an enclosing `run()` can.
 *
 * If you add an action and forget this, it fails loudly on the first read or
 * write with "Live store not loaded" — not silently, and not with bad data.
 */
export function withRequestStore<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ snapshot: null, original: null, client: null }, fn);
}

/**
 * The same scope, but reading and writing through a client the caller supplies.
 *
 * For the MCP server, which authenticates with a bearer token and therefore has
 * no session cookie for `createClient()` to find. Everything downstream —
 * `lib/data/*`, `lib/store/operations.ts`, `persistDiff` — is unchanged and
 * cannot tell the difference, which is the point: the MCP must not become a
 * second data layer.
 *
 * See `lib/mcp/viewer.ts` for which client is passed and why.
 */
export function withSuppliedClientStore<T>(
  client: StoreClient,
  fn: () => Promise<T>
): Promise<T> {
  return store.run({ snapshot: null, original: null, client }, fn);
}

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

  // Already loaded — by this request, or by a script that installed its own
  // backend. Check before touching `createClient`, which calls `cookies()` and
  // throws outside a request scope.
  if (hasLiveSnapshot()) return;

  const h = holder();
  if (h.snapshot) return;

  const supabase = h.client ?? (await createClient());
  if (!supabase) return;

  const loaded = await loadSnapshot(supabase);
  h.snapshot = loaded;
  h.original = snapshotCopy(loaded);
}

installLiveBackend(
  () => holder().snapshot,
  async (mutated) => {
    const h = holder();
    const supabase = h.client ?? (await createClient());
    if (!supabase || !h.original) return;

    await persistDiff(supabase, h.original, mutated);
    // The written state becomes the new baseline, so a second write in the
    // same request diffs against what's actually in the database rather than
    // re-sending the first write's changes.
    h.original = snapshotCopy(mutated);
  }
);
