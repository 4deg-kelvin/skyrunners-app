import { NextResponse } from "next/server";

import { sendDailyDigests } from "@/lib/notify/send-digest";
import { discordIsConfigured } from "@/lib/notify/discord";
import { todayInClubTime } from "@/lib/dates";

/**
 * ============================================================================
 * The evening digest — 7pm California, every day
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * Why this is a SECOND cron rather than a third pass on the first one
 * ---------------------------------------------------------------------------
 *
 * It started as a pass inside `/api/cron/checkin-reminders`, to keep the club
 * on one scheduled job. That was right until the digest needed a specific time
 * of day.
 *
 * The check-in cron runs at 19:30 UTC and the number is not arbitrary: every
 * check-in is due at 23:59 UTC, and 19:30 + a five-hour window is what makes
 * "due in about 4 hours" land before the deadline rather than after it. Moving
 * that job to 03:00 UTC would put the whole run PAST every deadline — the
 * "ahead" pass would find nothing and the nudge would silently become a
 * post-mortem.
 *
 * So the two jobs want genuinely different times, and one job cannot serve
 * both. Hence two entries in `vercel.json`.
 *
 * ---------------------------------------------------------------------------
 * The Hobby-plan trap, and what is and isn't the limit
 * ---------------------------------------------------------------------------
 *
 * An hourly schedule once failed EVERY deployment for four commits, and the
 * symptom was "my change isn't live" — pointing nowhere near `vercel.json`.
 * The limit that bit was FREQUENCY: on Hobby a cron may run at most once a
 * day. It is not a limit of one job.
 *
 * Both entries here run once daily, so both are inside it. If a deploy ever
 * starts failing right after a change to `vercel.json`, this is the first
 * place to look — and the fix is to reduce frequency or drop an entry, not to
 * debug the app.
 *
 * ---------------------------------------------------------------------------
 * 02:00 UTC, and why 7pm local is not exactly achievable
 * ---------------------------------------------------------------------------
 *
 * Anish asked for 7pm Pacific (2026-08-16). Vercel schedules in UTC and has no
 * notion of daylight saving, so "7pm California" is two different cron
 * expressions depending on the month:
 *
 *   7pm PDT (mid-Mar → early Nov) = 02:00 UTC
 *   7pm PST (early Nov → mid-Mar) = 03:00 UTC
 *
 * One entry cannot be both, and the Hobby frequency limit above rules out the
 * obvious workaround — scheduling hourly and gating on `todayInClubTime()`
 * inside the handler would be exact all year and would also fail every
 * deployment. Two daily entries (02:00 and 03:00, each no-opping when it is not
 * 19:00 locally) would work, but a third cron risks the same deploy failure for
 * an hour of accuracy, and `sendDailyDigests` would then be relied on to
 * de-duplicate rather than merely being safe to retry.
 *
 * So: 02:00 UTC, and what that actually means is
 *
 *   PDT: 7:00pm — exactly as asked
 *   PST: 6:00pm — an hour early
 *
 * 02:00 rather than 03:00 because PDT covers the months the club is busiest,
 * fall recruiting and the spring build season. If being an hour EARLY is ever
 * the worse failure, `0 3 * * *` flips it to 7pm in winter and 8pm in summer;
 * that is the whole change.
 *
 * **This is deliberately earlier than the day is over**, which reverses the
 * previous reasoning and is worth recording rather than quietly correcting. It
 * used to run at 05:00 UTC (10pm PDT) precisely so an evening in the lab had
 * finished and been logged before the day was summarised. At 7pm it has not, so
 * a member working after dinner sees their own evening in TOMORROW's digest.
 * That was Anish's call with the tradeoff on the table — do not "fix" it back to
 * 10pm without asking him.
 *
 * What the drift must NOT do is change which day gets summarised, and it still
 * doesn't: `todayInClubTime()` resolves the club's calendar day in Pacific, so at
 * both 02:00 and 03:00 UTC it returns the day currently ending in California,
 * exactly as 05:00 did. Using `new Date()` here instead would file a Tuesday
 * evening under Wednesday and then refuse to send Wednesday's — see
 * `lib/dates.ts`.
 */

/** Node, not Edge: the store and the Supabase admin client both need it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /*
    Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
    Without this the route is a public endpoint that DMs a third of the club to
    anybody who curls it.
  */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, reason: "CRON_SECRET is not set — refusing to run." },
      { status: 503 }
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!discordIsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "no Discord bot" });
  }

  const today = todayInClubTime();

  /*
    `sendDailyDigests` claims each member's day BEFORE sending, so a retry, a
    manual invocation while debugging, or an overlap with another run all find
    the rows already taken and send nothing. Safe to call by hand.
  */
  const result = await sendDailyDigests(today);

  return NextResponse.json({ ok: true, today, ...result });
}
