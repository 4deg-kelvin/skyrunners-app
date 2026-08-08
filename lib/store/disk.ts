import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import {
  members as seedMembers,
  projects as seedProjects,
  deliverables as seedDeliverables,
  joinRequests as seedJoinRequests,
  progressUpdates as seedProgressUpdates,
  updateSchedules as seedUpdateSchedules,
  projectMemberships as seedMemberships,
  workLogs as seedWorkLogs,
} from "../mock-data.ts";
import type {
  Member,
  Project,
  Deliverable,
  JoinRequest,
  ProgressUpdate,
  ProjectMembership,
  UpdateSchedule,
  WorkLog,
} from "../types.ts";

/**
 * ============================================================================
 * A JSON file pretending to be a database
 * ============================================================================
 *
 * Writes have to go somewhere before Kelvin's Supabase keys arrive, and the two
 * alternatives were both worse:
 *
 *   - In-memory only: every hour you log vanishes on the next hot reload. You
 *     can't evaluate whether logging hours *feels* right if the data doesn't
 *     survive the reload you trigger by looking at it.
 *   - Wait for Postgres: blocks phases 3 and 4 entirely on someone else.
 *
 * ---------------------------------------------------------------------------
 * What this is NOT
 * ---------------------------------------------------------------------------
 *
 * This is a local development convenience with a deliberately short life. It is
 * single-process, has no transactions across entities, and rewrites the entire
 * file on every write. That is fine for one developer and ~34 mock members, and
 * would be indefensible for 34 real ones.
 *
 * **It cannot run on Vercel.** Serverless filesystems are read-only and
 * per-invocation, so a deploy would silently accept writes and lose them. That's
 * the worst possible failure — the app looks like it works. `assertWritable()`
 * below makes it loud instead.
 *
 * ---------------------------------------------------------------------------
 * What only lives here
 * ---------------------------------------------------------------------------
 *
 * Only the collections that phases 2–4 actually mutate. Members, projects and
 * teams stay in `lib/mock-data.ts`, because nothing in these phases creates
 * them and copying them here would mean two sources of truth for the org chart.
 */

/** Everything that can change at runtime. */
export interface StoreShape {
  /** Bumped when the shape changes, so a stale file is discarded, not merged. */
  version: number;
  /**
   * People and projects are mutable now: leadership invites members, changes
   * roles and creates projects from inside the app. They used to be read-only
   * literals in mock-data, which is why those literals are still the SEED.
   */
  members: Member[];
  projects: Project[];
  workLogs: WorkLog[];
  deliverables: Deliverable[];
  projectMemberships: ProjectMembership[];
  joinRequests: JoinRequest[];
  progressUpdates: ProgressUpdate[];
  /** Which weekdays each member checks in on, and any academic pause. */
  updateSchedules: UpdateSchedule[];
}

/**
 * Raise this whenever `StoreShape` changes.
 *
 * On mismatch the file is re-seeded from mock data rather than migrated. That's
 * the right trade for throwaway local state: writing migrations for a store
 * that's going to be deleted is work spent on the wrong thing, and silently
 * half-migrating it would produce bugs that look like application bugs.
 */
const STORE_VERSION = 4;

/**
 * Overridable so the test suite doesn't write to the developer's real store.
 *
 * Without this, running `npm test` would silently rewrite `.data/store.json` —
 * you'd lose whatever you'd been clicking through, and worse, tests would pass
 * or fail depending on local state you forgot was there.
 */
const DATA_DIR = process.env.SKYRUNNERS_STORE_DIR
  ? process.env.SKYRUNNERS_STORE_DIR
  : join(process.cwd(), ".data");
const STORE_PATH = join(DATA_DIR, "store.json");

function seed(): StoreShape {
  // Deep-cloned, or a mutation here would write through to the mock module and
  // the "reset" button would hand back already-modified data.
  return structuredClone({
    version: STORE_VERSION,
    members: seedMembers,
    projects: seedProjects,
    workLogs: seedWorkLogs,
    deliverables: seedDeliverables,
    projectMemberships: seedMemberships,
    joinRequests: seedJoinRequests,
    progressUpdates: seedProgressUpdates,
    updateSchedules: seedUpdateSchedules,
  });
}

/**
 * Cached for the life of the process.
 *
 * Reading a few hundred KB of JSON per request would be wasteful, and — more
 * importantly — two requests reading, editing and writing independently would
 * lose one of the edits. One in-process copy is the source of truth; the file is
 * a persistence detail.
 */
let cache: StoreShape | null = null;
let writable: boolean | null = null;

function load(): StoreShape {
  if (cache) return cache;

  try {
    if (existsSync(STORE_PATH)) {
      const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as StoreShape;
      if (parsed.version === STORE_VERSION) {
        cache = parsed;
        return cache;
      }
      console.warn(
        `[store] .data/store.json is v${parsed.version}, expected v${STORE_VERSION} — re-seeding from mock data.`
      );
    }
  } catch (error) {
    // A corrupt file must not brick the app. Re-seed and say so loudly.
    console.warn(
      `[store] Could not read .data/store.json (${(error as Error).message}) — re-seeding.`
    );
  }

  cache = seed();
  persist();
  return cache;
}

/**
 * Write the whole file, atomically.
 *
 * Via a temp file and a rename because `writeFileSync` truncates first: an
 * interrupted write (Ctrl-C during `npm run dev`, which happens constantly)
 * would leave a half-written JSON file that fails to parse on next boot.
 * `rename` is atomic on both NTFS and POSIX, so the file is always either the
 * old version or the new one.
 */
function persist() {
  if (!cache) return;

  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    renameSync(tmp, STORE_PATH);
    writable = true;
  } catch (error) {
    if (writable !== false) {
      writable = false;
      console.error(
        `[store] CANNOT WRITE to ${STORE_PATH} (${(error as Error).message}).\n` +
          `[store] Changes will work in this process and be LOST on restart.\n` +
          `[store] This is expected on Vercel — the disk store is local-only.`
      );
    }
  }
}

/** Read-only snapshot. Never mutate what this returns. */
export function readStore(): Readonly<StoreShape> {
  return load();
}

/**
 * Serialised read-modify-write.
 *
 * Chained through a promise so two concurrent Server Actions can't interleave.
 * Next handles requests concurrently even in dev, and "log hours" fired twice
 * quickly is exactly the sort of thing that drops one write.
 *
 * The mutator runs against the live object and may edit it in place; whatever it
 * returns is ignored.
 */
let queue: Promise<unknown> = Promise.resolve();

export function mutate<T>(fn: (store: StoreShape) => T): Promise<T> {
  const run = queue.then(() => {
    const store = load();
    const result = fn(store);
    persist();
    return result;
  });
  // Keep the chain alive even if this mutation throws, or one failed write
  // would deadlock every subsequent one.
  queue = run.catch(() => undefined);
  return run;
}

/** Throw away all local changes and start again from mock data. */
export function resetStore(): void {
  cache = seed();
  persist();
}

/**
 * True when writes are actually landing on disk.
 *
 * `null` means nothing has been written yet, so it isn't known. The UI uses this
 * to warn rather than to gate — a false negative should never block the app.
 */
export function isPersistent(): boolean | null {
  return writable;
}

/**
 * Drop the in-memory copy, forcing the next read to come off disk.
 *
 * Only for tests, and specifically for the one test that matters most here:
 * that a write actually round-trips through the file rather than just living in
 * `cache`. Without this the whole suite would pass against an in-memory store
 * and prove nothing about persistence — which is the entire feature.
 */
export function __resetCacheForTests(): void {
  cache = null;
}
