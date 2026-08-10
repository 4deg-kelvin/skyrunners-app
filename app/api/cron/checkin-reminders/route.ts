import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordDM, discordIsConfigured } from "@/lib/notify/discord";
import { formatDay, todayInClubTime } from "@/lib/dates";

/**
 * ============================================================================
 * The two scheduled check-in messages: a nudge before, a follow-up after
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * Four hours before, and only if they haven't written it
 * ---------------------------------------------------------------------------
 *
 * Late enough that they've had the day to do the work, early enough that it's
 * still actionable — a nudge at 11pm for an 11:59pm deadline is a reproach,
 * not a reminder. And it's suppressed the moment somebody submits, so nobody
 * who has already done the thing is ever told to do the thing. That single
 * rule is what separates a reminder people tolerate from one they mute.
 *
 * ---------------------------------------------------------------------------
 * Then once, the day after, if it still isn't written
 * ---------------------------------------------------------------------------
 *
 * ONCE. Not daily until they comply. A member who is late already knows; what
 * they need is a link and a reminder that the academic pause exists, not a bot
 * repeating itself every morning. If they stay late past that, it stops being
 * a notification problem and becomes their Lead's — `lib/review.ts` escalates
 * on age, which names one person and is actionable in a way a fourth DM isn't.
 *
 * `late_notice_sent_at` (migration 0029) is what makes it once, exactly as
 * `reminder_sent_at` does for the nudge. Both passes run in this one route so
 * the club needs one cron job rather than two.
 *
 * ---------------------------------------------------------------------------
 * Once a day, at 19:30 UTC — and do NOT make it hourly
 * ---------------------------------------------------------------------------
 *
 * It was hourly for four commits and **every deployment failed**. Vercel's
 * Hobby plan allows cron jobs that run at most once a day, and it doesn't
 * reject the cron — it rejects the whole deploy. So an unrelated schedule
 * string silently stopped the site updating, and the symptom was "my change
 * isn't live", which points nowhere near `vercel.json`. If you make this more
 * frequent, check the plan first.
 *
 * Daily is enough, and always was. Every check-in is due at **23:59 UTC** —
 * `operations.ts` writes `${today}T23:59` and the database is UTC — so one run
 * at 19:30 with a five-hour window catches every obligation in the club with
 * margin on both sides. Hourly was doing the same work twenty-three extra
 * times a day and finding nothing.
 *
 * The margin is the point of the odd numbers: a Vercel cron can fire late but
 * never early, so 19:30 + 5h covers 23:59 even if the run slips half an hour.
 * The message quotes the real gap it computes, so it still reads "due in about
 * 4 hours".
 *
 * ---------------------------------------------------------------------------
 * Why this can't run in a Server Action
 * ---------------------------------------------------------------------------
 *
 * Nothing triggers it. Every other notification in the app hangs off somebody
 * pressing a button; this one has to happen because time passed, which means a
 * scheduler — Vercel Cron, configured in `vercel.json`.
 *
 * A cron has no signed-in user, so `auth.uid()` is null and no RLS policy can
 * grant it anything: a normal client would read zero rows and cheerfully report
 * success. Hence the service-role client, whose caveats are spelled out in
 * `lib/supabase/admin.ts`. This route is its only legitimate caller.
 *
 * ---------------------------------------------------------------------------
 * Sending twice is the failure mode to design against
 * ---------------------------------------------------------------------------
 *
 * A daily job needs this less than an hourly one did, but it still needs it: a
 * retry, a manual invocation while debugging, or a future schedule change would
 * all re-nudge people who were already told. `reminder_sent_at` (migration
 * 0027) is that memory, and it's written BEFORE the DM rather than after — a
 * crash between the two costs one missed reminder, where the other order costs
 * a duplicate on every retry. Missing one is much cheaper.
 */

/**
 * How far ahead of the deadline to look.
 *
 * Five, not four, because the run is daily and fixed: the window has to reach
 * 23:59 UTC from a 19:30 start even if Vercel fires the job late. The DM quotes
 * the gap it actually measures, so people still read "about 4 hours".
 */
const HOURS_BEFORE = 5;

/**
 * How far back to chase a missed check-in.
 *
 * A day plus slack, so each run picks up exactly the deadlines that passed
 * since the last one and nothing older. Two reasons it's bounded rather than
 * "anything overdue":
 *
 *   - The first run after this shipped would otherwise DM everybody about
 *     every check-in they have ever missed. A bot's first words to the club
 *     should not be a pile of reproaches from July.
 *   - An obligation from three weeks ago is not news, and telling somebody
 *     about it teaches them the messages aren't worth reading.
 *
 * 30 rather than 24 because a Vercel cron can fire late; the windows have to
 * overlap or a deadline can fall between two runs and never be chased.
 */
const LATE_WINDOW_HOURS = 30;

/** One obligation, as much of it as either pass needs. */
type Pending = { id: string; member_id: string; due_at: string };

export async function GET(request: Request) {
  /*
    Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
    Without this the route is a public endpoint that DMs the entire club to
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

  const supabase = createAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY is not set." },
      { status: 503 }
    );
  }

  const now = new Date();
  const soon = new Date(now.getTime() + HOURS_BEFORE * 3_600_000);
  const lateFloor = new Date(now.getTime() - LATE_WINDOW_HOURS * 3_600_000);

  /*
    Two passes, one run.

      AHEAD — due soon, never reminded. "This is due in about 4 hours."
      LATE  — the deadline passed, never chased. "This is still open."

    They are deliberately separate messages rather than one query, because
    being told something is "due in 4 hours" when it was due yesterday is worse
    than silence — it reads as a bot that can't tell the time, and that is how
    a channel gets muted. Each column is the other's guarantee that nobody gets
    both halves twice.

    Two passes also mean one cron job instead of two, which is what the Hobby
    plan allows — see the header.
  */
  const [ahead, late] = await Promise.all([
    supabase
      .from("progress_updates")
      .select("id, member_id, due_at")
      .eq("status", "pending")
      .is("reminder_sent_at", null)
      .gte("due_at", now.toISOString())
      .lte("due_at", soon.toISOString()),
    supabase
      .from("progress_updates")
      .select("id, member_id, due_at")
      .eq("status", "pending")
      .is("late_notice_sent_at", null)
      .gte("due_at", lateFloor.toISOString())
      .lt("due_at", now.toISOString()),
  ]);

  const failure = ahead.error ?? late.error;
  if (failure) {
    return NextResponse.json(
      { ok: false, reason: failure.message },
      { status: 500 }
    );
  }

  const aheadRows = (ahead.data ?? []) as Pending[];
  const lateRows = (late.data ?? []) as Pending[];
  if (aheadRows.length === 0 && lateRows.length === 0) {
    return NextResponse.json({ ok: true, reminded: 0, chased: 0 });
  }

  /*
    Everybody's Discord id and pause state in one query rather than one per
    member. Paused members are excluded here rather than in the queries above,
    because the pause lives on `update_schedules` and joining it would trade a
    readable filter for a nested select that does the same thing.
  */
  const memberIds = [
    ...new Set([...aheadRows, ...lateRows].map((u) => u.member_id)),
  ];
  const [{ data: profiles }, { data: schedules }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, preferred_name, full_name, discord_user_id")
      .in("id", memberIds),
    supabase
      .from("update_schedules")
      .select("member_id, paused_until")
      .in("member_id", memberIds),
  ]);

  // The pause is a Pacific calendar date, so it has to be compared against
  // one. In UTC this job treats a pause ending today as already over from 5pm
  // the day before.
  const today = todayInClubTime(now);
  const pausedUntil = new Map(
    (schedules ?? []).map((s) => [
      s.member_id as string,
      s.paused_until as string | null,
    ])
  );
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  /**
   * Claim the row, then send. Returns whether a DM actually went out.
   *
   * The claim is written FIRST and is conditional on the column still being
   * null, so a retry or an overlapping invocation can't double-send: the second
   * one updates zero rows and gives up. A crash between the two costs one
   * missed message, which is much cheaper than a duplicate on every retry.
   */
  async function deliver(
    row: Pending,
    column: "reminder_sent_at" | "late_notice_sent_at",
    body: (name: string) => string
  ): Promise<boolean> {
    const profile = profileById.get(row.member_id);
    const discordId = profile?.discord_user_id as string | undefined;

    // No Discord, or paused for academics — nothing owed and nothing to send.
    const paused = pausedUntil.get(row.member_id);
    if (!discordId || (paused && paused > today)) return false;

    const { data: claimed, error: claimError } = await supabase!
      .from("progress_updates")
      .update({ [column]: now.toISOString() })
      .eq("id", row.id)
      .is(column, null)
      .select();

    if (claimError || !claimed || claimed.length === 0) return false;

    const name =
      (profile?.preferred_name as string) ||
      (profile?.full_name as string) ||
      "there";
    return sendDiscordDM(discordId, body(name));
  }

  let reminded = 0;
  for (const row of aheadRows) {
    const hours = Math.max(
      1,
      Math.round((Date.parse(row.due_at) - now.getTime()) / 3_600_000)
    );
    const ok = await deliver(
      row,
      "reminder_sent_at",
      (name) =>
        `Hi ${name} — your check-in is due in about ${hours} ${hours === 1 ? "hour" : "hours"}.\n` +
        `A line per project is enough, and "I'm stuck on X" is a perfectly good check-in.\n` +
        `${appUrl()}/my-work`
    );
    if (ok) reminded++;
  }

  let chased = 0;
  for (const row of lateRows) {
    // Named from the Pacific day the obligation belongs to. `due_at` is 23:59
    // of that day stored as UTC, so it is already UTC-anchored.
    const when = formatDay(row.due_at, { weekday: "long" });
    const ok = await deliver(
      row,
      "late_notice_sent_at",
      (name) =>
        `Hi ${name} — your ${when} check-in is still open.\n` +
        `It doesn't have to be long: a line per project, and "I got nothing done, here's why" is a real check-in — it's how your Lead finds out you need something.\n` +
        `If the week has got away from you, you can pause check-ins for academics in Settings without it counting against you.\n` +
        `${appUrl()}/my-work`
    );
    if (ok) chased++;
  }

  /*
    One message per member per obligation, and never both halves of the pair —
    the reminder claims `reminder_sent_at` before the deadline, the follow-up
    claims `late_notice_sent_at` after it, and neither pass can see the other's
    rows. Somebody who ignores the follow-up hears nothing further: staying
    late stops being a notification problem and becomes their Lead's, which is
    what the escalation in `lib/review.ts` is for.
  */
  return NextResponse.json({
    ok: true,
    reminded,
    chased,
    considered: aheadRows.length + lateRows.length,
  });
}

/** Absolute, because a DM is read with no browser context. */
function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  );
}
