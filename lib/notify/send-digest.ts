/**
 * Sending the daily digest. The half that touches the network and the clock.
 *
 * Split from `digest.ts`, which is pure and builds the text, so the hard rules
 * — what a quiet project says, who gets nothing — are testable without a
 * database or Discord.
 *
 * Called from `/api/cron/daily-digest`, which owns the schedule and explains
 * why it is a second cron rather than another pass on the check-in job.
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
  /** Member ids Discord refused, so a name can be chased rather than a count. */
  failed: string[];
}

/**
 * Build and send today's digests.
 *
 * `today` is the CLUB's day, not UTC's. The cron fires at 05:00 UTC, which is
 * already the next calendar day in UTC but is still the same working evening in
 * California — writing `now()::date` here would file a Tuesday evening's digest
 * under Wednesday and then refuse to send Wednesday's.
 */
export async function sendDailyDigests(today: string): Promise<DigestRun> {
  const admin = createAdminClient();
  if (!admin) return { sent: 0, considered: 0, skipped: 0, failed: [] };

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
  const failed: string[] = [];

  for (const digest of digests) {
    /*
      Claim the day BEFORE sending, exactly like `reminder_sent_at` in 0027. A
      crash between the two costs one missed digest; the other order costs a
      duplicate on every retry, and a bot that repeats itself daily is one
      people mute.

      The `.or(...)` guard makes the claim atomic: two concurrent invocations
      race for the same row and only one updates it.
    */
    const { data: claimed } = await admin
      .from("profiles")
      .update({ daily_digest_sent_on: today })
      .eq("id", digest.memberId)
      .or(`daily_digest_sent_on.is.null,daily_digest_sent_on.neq.${today}`)
      .select("id");

    if (!claimed || claimed.length === 0) continue;

    if (await sendDiscordDM(digest.discordUserId, digest.body)) {
      sent++;
      continue;
    }

    /*
      RELEASE the claim when Discord refused it.

      Claim-before-send stops duplicates, but on its own it also means a failed
      delivery silently burns the day: the row says "sent", nobody got
      anything, and the next run skips that person entirely.

      Found by looking rather than by breaking. On the first night's run four
      rows were claimed and the DMs did arrive — but while checking whether
      they had, it became clear the database could not answer the question:
      a refusal and a success wrote exactly the same value. That is the gap
      this closes, before a real refusal makes somebody quietly disappear from
      a daily message.

      Clearing it is safe. `sendDiscordDM` returns false only when Discord
      rejected the request outright — no message was delivered — so a retry
      cannot duplicate anything. The cost of being wrong here is one repeated
      digest; the cost of the old behaviour was a member dropped with no trace.
    */
    await admin
      .from("profiles")
      .update({ daily_digest_sent_on: null })
      .eq("id", digest.memberId);

    failed.push(digest.memberId);
  }

  /*
    Named in the response, not just counted. "sent: 3, failed: 1" with an id is
    something Kelvin can act on from the Vercel log; "sent: 3" alone leaves the
    missing person invisible.
  */
  return { sent, considered: digests.length, skipped: skip.size, failed };
}
