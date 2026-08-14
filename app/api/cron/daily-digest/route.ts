import { NextResponse } from "next/server";

import { sendDailyDigests } from "@/lib/notify/send-digest";
import { discordIsConfigured } from "@/lib/notify/discord";
import { todayInClubTime } from "@/lib/dates";

/**
 * ============================================================================
 * The evening digest — 8pm California, every day
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
 * 03:00 UTC, and what that means through the year
 * ---------------------------------------------------------------------------
 *
 * Vercel schedules in UTC and has no notion of daylight saving, so a fixed
 * cron drifts against California by an hour twice a year:
 *
 *   PDT (mid-Mar → early Nov):  03:00 UTC = 8pm the previous day
 *   PST (early Nov → mid-Mar):  03:00 UTC = 7pm the previous day
 *
 * 8pm in term time is the point of it — late enough that an evening in the lab
 * is over and today's hours are logged. The winter hour of drift lands at 7pm,
 * which is still after the working day, so it is left alone rather than
 * chasing DST with two schedules.
 *
 * What the drift must NOT do is change which day gets summarised, and it
 * doesn't: `todayInClubTime()` resolves the club's calendar day in Pacific, so
 * at 03:00 UTC it returns the day that has just ended in California under
 * either offset. Using `new Date()` here instead would file a Tuesday evening
 * under Wednesday and then refuse to send Wednesday's — see `lib/dates.ts`.
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
