/**
 * The Postgres backend for the store.
 *
 * ---------------------------------------------------------------------------
 * The bet this file makes
 * ---------------------------------------------------------------------------
 *
 * `operations.ts` has ~20 write functions. Porting each one to SQL by hand
 * would be twenty chances to get a rule subtly wrong, and would throw away the
 * tests that already pin those rules.
 *
 * Instead: because every write already funnels through `mutate()`, this loads a
 * snapshot, lets the operation mutate it exactly as it does on disk, then DIFFS
 * the before and after and writes only what changed. Not one operation needs to
 * know Postgres exists, and every existing test still covers the real logic.
 *
 * The cost is that a write costs a read first. At ~35 members and a few hundred
 * rows that's one round trip of a few hundred kilobytes — fine, and honest about
 * where it stops being fine (see the note on scale below).
 *
 * ---------------------------------------------------------------------------
 * Concurrency
 * ---------------------------------------------------------------------------
 *
 * Two people writing at the same instant both diff against their own snapshot,
 * so the later write can revert a field the earlier one changed. Rows are
 * touched individually rather than wholesale, so the blast radius is one field
 * on one row, and the operations that matter (logging hours, submitting a
 * check-in) append rather than overwrite.
 *
 * That's an acceptable trade for a 35-person club and NOT one to keep if this
 * grows. The fix, when it's needed, is to push each operation down into SQL —
 * which is why `mapping.ts` describes tables rather than hiding them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COLLECTIONS,
  HELP_REPLY_COLUMNS,
  helpReplyFromRow,
  helpReplyToRow,
} from "./mapping.ts";
import type { StoreShape } from "./disk.ts";
import type {
  HelpReply,
  HelpRequest,
  ProgressUpdate,
  UpdateEntry,
} from "../types.ts";

/** Columns for the entries table, which has no collection of its own. */
const ENTRY_COLUMNS =
  "id, update_id, project_id, progress, blockers, next_steps, hours";

function entryFromRow(r: Record<string, unknown>): UpdateEntry {
  return {
    id: r.id as string,
    updateId: r.update_id as string,
    projectId: r.project_id as string,
    progress: (r.progress as string) ?? "",
    blockers: (r.blockers as string) ?? undefined,
    nextSteps: (r.next_steps as string) ?? undefined,
    hours: Number(r.hours ?? 0),
  };
}

function entryToRow(e: UpdateEntry) {
  return {
    id: e.id,
    update_id: e.updateId,
    project_id: e.projectId,
    progress: e.progress,
    blockers: e.blockers ?? null,
    next_steps: e.nextSteps ?? null,
    hours: e.hours,
  };
}

/**
 * Read the whole database into one snapshot.
 *
 * Every table in parallel. Deliberately not lazy: `readStore()` is synchronous
 * because `OrgGraph`'s lookups are called in loops while walking trees, and
 * making them async would turn one permission check into fifty round trips.
 */
export async function loadSnapshot(
  supabase: SupabaseClient
): Promise<StoreShape> {
  const results = await Promise.all([
    ...COLLECTIONS.map((c) => supabase.from(c.table).select(c.columns)),
    supabase.from("update_entries").select(ENTRY_COLUMNS),
    supabase.from("help_replies").select(HELP_REPLY_COLUMNS),
  ]);

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    // Fail loudly. A partially-loaded snapshot silently strips people of
    // permissions and would then be written back, deleting the rows that
    // failed to load.
    throw new Error(`Could not load the database: ${failed.error.message}`);
  }

  const snapshot = { version: -1 } as unknown as StoreShape;

  COLLECTIONS.forEach((spec, i) => {
    const rows = (results[i].data ?? []) as Record<string, unknown>[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (snapshot as any)[spec.key] = rows.map((r) => spec.fromRow(r));
  });

  // --- stitch the two halves of an update back together --------------------
  const entryRows = (results[COLLECTIONS.length].data ??
    []) as Record<string, unknown>[];
  const entriesByUpdate = new Map<string, UpdateEntry[]>();
  for (const row of entryRows) {
    const entry = entryFromRow(row);
    const list = entriesByUpdate.get(entry.updateId);
    if (list) list.push(entry);
    else entriesByUpdate.set(entry.updateId, [entry]);
  }
  for (const update of snapshot.progressUpdates as ProgressUpdate[]) {
    update.entries = entriesByUpdate.get(update.id) ?? [];
  }

  // --- and the same for a help request's replies ---------------------------
  const replyRows = (results[COLLECTIONS.length + 1].data ??
    []) as Record<string, unknown>[];
  const repliesByRequest = new Map<string, HelpReply[]>();
  for (const row of replyRows) {
    const reply = helpReplyFromRow(row);
    const list = repliesByRequest.get(reply.requestId);
    if (list) list.push(reply);
    else repliesByRequest.set(reply.requestId, [reply]);
  }
  for (const request of snapshot.helpRequests as HelpRequest[]) {
    // Oldest first: a thread reads top to bottom.
    request.replies = (repliesByRequest.get(request.id) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  // --- derive project.reIds from memberships -------------------------------
  //
  // `reIds` is what every permission check reads, and it is NOT a column. It's
  // the `role = 're'` rows plus the primary, who must count even if their
  // membership row is missing — two tables that nothing forces to agree.
  const reByProject = new Map<string, string[]>();
  for (const m of snapshot.projectMemberships) {
    if (m.role !== "re") continue;
    const list = reByProject.get(m.projectId);
    if (list) list.push(m.memberId);
    else reByProject.set(m.projectId, [m.memberId]);
  }
  for (const project of snapshot.projects) {
    const ids = reByProject.get(project.id) ?? [];
    if (project.primaryReId && !ids.includes(project.primaryReId)) {
      ids.unshift(project.primaryReId);
    }
    project.reIds = ids;
  }

  return snapshot;
}

/** Deep copy, so a mutation can be diffed against where it started. */
export function snapshotCopy(store: StoreShape): StoreShape {
  return structuredClone(store);
}

function sameRow(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Write back only what changed.
 *
 * Inserts and updates run in `COLLECTIONS` order and deletes in reverse, so a
 * row is never written before the row it references, nor deleted while
 * something still points at it.
 */
export async function persistDiff(
  supabase: SupabaseClient,
  before: StoreShape,
  after: StoreShape
): Promise<void> {
  const deletions: (() => Promise<void>)[] = [];

  for (const spec of COLLECTIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wasList = (before as any)[spec.key] as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nowList = (after as any)[spec.key] as any[];

    const was = new Map(wasList.map((v) => [spec.identify(v), v]));
    const now = new Map(nowList.map((v) => [spec.identify(v), v]));

    const upserts = nowList.filter((v) => {
      const prev = was.get(spec.identify(v));
      return !prev || !sameRow(spec.toRow(prev), spec.toRow(v));
    });

    if (upserts.length > 0) {
      const { error } = await supabase
        .from(spec.table)
        .upsert(
          upserts.map((v) => spec.toRow(v)),
          spec.conflictTarget ? { onConflict: spec.conflictTarget } : undefined
        );
      if (error) {
        throw new Error(`Saving ${spec.table} failed: ${error.message}`);
      }
    }

    const removed = wasList.filter((v) => !now.has(spec.identify(v)));
    if (removed.length > 0) {
      deletions.unshift(async () => {
        for (const value of removed) {
          const row = spec.toRow(value);
          let query = supabase.from(spec.table).delete();
          // Join tables have no id, so delete by the same composite key the
          // diff identifies them with.
          if ("id" in row && row.id) {
            query = query.eq("id", row.id as string);
          } else {
            for (const [col, val] of Object.entries(row)) {
              if (col.endsWith("_id")) query = query.eq(col, val as string);
            }
          }
          const { error } = await query;
          if (error) {
            throw new Error(`Deleting from ${spec.table} failed: ${error.message}`);
          }
        }
      });
    }
  }

  // --- update entries ------------------------------------------------------
  //
  // Not a collection of its own because the app carries entries inline on the
  // update. Submitting a check-in replaces the whole set, so diff them flat.
  const wasEntries = new Map(
    before.progressUpdates.flatMap((u) => u.entries.map((e) => [e.id, e]))
  );
  const nowEntries = new Map(
    after.progressUpdates.flatMap((u) => u.entries.map((e) => [e.id, e]))
  );

  const entryUpserts = [...nowEntries.values()].filter((e) => {
    const prev = wasEntries.get(e.id);
    return !prev || !sameRow(entryToRow(prev), entryToRow(e));
  });
  if (entryUpserts.length > 0) {
    const { error } = await supabase
      .from("update_entries")
      .upsert(entryUpserts.map(entryToRow));
    if (error) throw new Error(`Saving update_entries failed: ${error.message}`);
  }

  const goneEntries = [...wasEntries.keys()].filter((id) => !nowEntries.has(id));
  if (goneEntries.length > 0) {
    const { error } = await supabase
      .from("update_entries")
      .delete()
      .in("id", goneEntries);
    if (error) {
      throw new Error(`Deleting update_entries failed: ${error.message}`);
    }
  }

  // --- help replies --------------------------------------------------------
  //
  // Same shape as update entries: carried inline on the request, stored in
  // their own table, so they diff flat.
  const wasReplies = new Map(
    before.helpRequests.flatMap((h) => h.replies.map((r) => [r.id, r]))
  );
  const nowReplies = new Map(
    after.helpRequests.flatMap((h) => h.replies.map((r) => [r.id, r]))
  );

  const replyUpserts = [...nowReplies.values()].filter((r) => {
    const prev = wasReplies.get(r.id);
    return !prev || !sameRow(helpReplyToRow(prev), helpReplyToRow(r));
  });
  if (replyUpserts.length > 0) {
    const { error } = await supabase
      .from("help_replies")
      .upsert(replyUpserts.map(helpReplyToRow));
    if (error) throw new Error(`Saving help_replies failed: ${error.message}`);
  }

  const goneReplies = [...wasReplies.keys()].filter((id) => !nowReplies.has(id));
  if (goneReplies.length > 0) {
    const { error } = await supabase
      .from("help_replies")
      .delete()
      .in("id", goneReplies);
    if (error) {
      throw new Error(`Deleting help_replies failed: ${error.message}`);
    }
  }

  for (const run of deletions) await run();
}
