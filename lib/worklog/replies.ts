/**
 * Replies to work-log lines.
 *
 * ===========================================================================
 * Fails soft, deliberately
 * ===========================================================================
 *
 * `work_log_replies` arrives in migration 0045 and the app deploys by pushing to
 * main, so there is a window where this code is live and the table is not. Reading
 * it through its own query rather than the per-request snapshot makes that window
 * harmless: a missing table is one swallowed error and "no replies", which is also
 * the truthful answer before the migration lands.
 *
 * Same pattern and same justification as `lib/advisors/store.ts`. The cost is that
 * a genuine database fault reads as "no replies" rather than shouting; accepted,
 * because the alternative is a project page that 500s for the whole club.
 *
 * A failed WRITE is reported, unlike a failed read — somebody pressed a button and
 * is waiting to be told whether it worked.
 */

import { createClient } from "@/lib/supabase/server";

export interface WorkLogReply {
  response: string;
  /** Profile id of whoever answered. The page resolves the name from the store. */
  respondedBy?: string;
}

const COLUMNS = "work_log_id, response, responded_by";

/**
 * Every reply on one project, keyed by work-log id.
 *
 * One query per project page rather than one per line — the feed renders up to
 * three weeks of entries, and a query inside that loop is the round-trip-per-row
 * mistake `lib/data/*` exists to prevent.
 */
export async function workLogRepliesFor(
  projectId: string
): Promise<Record<string, WorkLogReply>> {
  const supabase = await createClient();
  if (!supabase) return {};

  const { data, error } = await supabase
    .from("work_log_replies")
    .select(COLUMNS)
    .eq("project_id", projectId);

  if (error) {
    // Expected before 0045 is applied. Logged, never thrown.
    console.error("[worklog] reply read failed", error.message);
    return {};
  }

  const out: Record<string, WorkLogReply> = {};
  for (const row of (data ?? []) as unknown as {
    work_log_id: string;
    response: string;
    responded_by: string | null;
  }[]) {
    out[row.work_log_id] = {
      response: row.response,
      ...(row.responded_by ? { respondedBy: row.responded_by } : {}),
    };
  }
  return out;
}

export type SaveReplyResult = { ok: true } | { ok: false; error: string };

/**
 * Write or clear one reply.
 *
 * An empty `response` DELETES the row rather than storing a blank, which is what
 * "clearing the box removes the reply" means on the check-in side. Storing "" would
 * render an empty reply panel that nobody can get rid of.
 *
 * Permission is the CALLER's job — `replyToWorkLogAction` asks
 * `can.manageProject` before getting here, exactly as the check-in reply does. The
 * RLS policy is the backstop, and it uses the same `auth_is_re_for` the rest of the
 * project writes use so the two cannot disagree.
 */
export async function saveWorkLogReply(input: {
  workLogId: string;
  projectId: string;
  response: string;
  responderId: string;
}): Promise<SaveReplyResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "Not available in demo mode." };

  const text = input.response.trim();

  const { error } = text
    ? await supabase.from("work_log_replies").upsert(
        {
          work_log_id: input.workLogId,
          project_id: input.projectId,
          response: text,
          responded_by: input.responderId,
          responded_at: new Date().toISOString(),
        },
        { onConflict: "work_log_id" }
      )
    : await supabase
        .from("work_log_replies")
        .delete()
        .eq("work_log_id", input.workLogId);

  if (error) {
    /*
      Named specifically, because there is one likely cause with one fix. Raw
      Postgres text about a missing relation tells an RE nothing they can act on.
    */
    const missing =
      error.message.includes("work_log_replies") &&
      /does not exist|not find/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? "Replying to a logged line needs one database migration that hasn't been applied yet (supabase/migrations/0045_work_log_replies.sql). Tell whoever runs the site — replying to a check-in entry works meanwhile."
        : `Couldn't save that reply: ${error.message}`,
    };
  }
  return { ok: true };
}
