/**
 * Sending the daily digest. The half that touches the network and the clock.
 *
 * Split from `digest.ts`, which is pure and builds the text, so the hard rules
 * — what a quiet project says, who gets nothing — are testable without a
 * database or Discord.
 *
 * ---------------------------------------------------------------------------
 * Why this rides on the check-in cron instead of its own
 * ---------------------------------------------------------------------------
 *
 * Vercel's Hobby plan allows a cron to run at most once a day, and it rejects
 * the whole DEPLOY rather than just the cron when you break that. An unrelated
 * schedule string once stopped the site updating for four commits, and the
 * symptom was "my change isn't live" — pointing nowhere near `vercel.json`.
 *
 * Adding a second cron entry is the obvious move and is exactly the thing not
 * to do. One route, three passes.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { loadLiveOrgGraph } from "@/lib/data/graph";
import { preloadLiveStore, withSuppliedClientStore } from "@/lib/store/request";
import { sendDiscordDM } from "@/lib/notify/discord";
import { buildDigests } from "@/lib/notify/digest";

export interface DigestRun {
  sent: number;
  considered: number;
  skipped: number;
}

/**
 * Build and send today's digests.
 *
 * `today` is the CLUB's day, not UTC's. The cron fires at 19:30 UTC, which is
 * already the next calendar day in UTC for part of the year but is still the
 * same working evening in California — writing `now()::date` here would file a
 * Tuesday evening's digest under Wednesday and then refuse to send Wednesday's.
 */
export async function sendDailyDigests(today: string): Promise<DigestRun> {
  const admin = createAdminClient();
  if (!admin) return { sent: 0, considered: 0, skipped: 0 };

  /*
    Who is already handled: opted out, or already had today's.

    Read BEFORE building, so a retry that lands mid-run sees the rows the first
    attempt already claimed and skips them.
  */
  const { data: handled } = await admin
    .from("profiles")
    .select("id")
    .or(`daily_digest_opt_out.eq.true,daily_digest_sent_on.eq.${today}`);

  const skip = new Set((handled ?? []).map((r) => r.id as string));

  /*
    Same pattern as the MCP server: open a store scope with the admin client,
    preload the snapshot, then use the ordinary in-memory reads and
    `lib/permissions.ts`. That's what lets the digest resolve RE authority with
    `isREofOrAbove` instead of matching `reIds` — which would miss inherited
    authority and every Division Lead.
  */
  const digests = await withSuppliedClientStore(admin, async () => {
    await preloadLiveStore();
    return buildDigests({ today, graph: await loadLiveOrgGraph(admin), skip });
  });

  let sent = 0;

  for (const digest of digests) {
    /*
      Claim the day BEFORE sending, exactly like `reminder_sent_at` in 0027. A
      crash between the two costs one missed digest; the other order costs a
      duplicate on every retry, and a bot that repeats itself daily is one
      people mute.

      The `.is(... , null).or(...)` guard makes the claim atomic: two concurrent
      invocations race for the same row and only one updates it.
    */
    const { data: claimed } = await admin
      .from("profiles")
      .update({ daily_digest_sent_on: today })
      .eq("id", digest.memberId)
      .or(`daily_digest_sent_on.is.null,daily_digest_sent_on.neq.${today}`)
      .select("id");

    if (!claimed || claimed.length === 0) continue;

    if (await sendDiscordDM(digest.discordUserId, digest.body)) sent++;
  }

  return { sent, considered: digests.length, skipped: skip.size };
}
