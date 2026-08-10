import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordDM, discordIsConfigured } from "@/lib/notify/discord";

/**
 * ============================================================================
 * "Your check-in is due in a few hours" — the only scheduled notification
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
 * Why this can't run in a Server Action
 * ---------------------------------------------------------------------------
 *
 * Nothing triggers it. Every other notification in the app hangs off somebody
 * pressing a button; this one has to happen because time passed, which means a
 * scheduler — Vercel Cron, hourly, configured in `vercel.json`.
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
 * The job runs hourly and the window is four hours wide, so without a memory
 * every member would get four identical nudges per check-in. `reminder_sent_at`
 * (migration 0027) is that memory, and it's written BEFORE the DM rather than
 * after: a crash between the two costs one missed reminder, where the other
 * order costs a duplicate on every retry. Missing one is much cheaper.
 */

/** How far ahead of the deadline to nudge. */
const HOURS_BEFORE = 4;

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
  const cutoff = new Date(now.getTime() + HOURS_BEFORE * 3_600_000);

  /*
    Due inside the window, still pending, not already nudged.

    `gte(now)` matters as much as the upper bound: an obligation whose deadline
    has already passed is late, and being told "due in 4 hours" about something
    that was due yesterday is worse than silence. Lateness escalates to their
    Lead through `lib/review.ts`, which is the right channel for it.
  */
  const { data: due, error } = await supabase
    .from("progress_updates")
    .select("id, member_id, due_at")
    .eq("status", "pending")
    .is("reminder_sent_at", null)
    .gte("due_at", now.toISOString())
    .lte("due_at", cutoff.toISOString());

  if (error) {
    return NextResponse.json(
      { ok: false, reason: error.message },
      { status: 500 }
    );
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  /*
    Everybody's Discord id and pause state in one query rather than one per
    member. Paused members are excluded here rather than in the query above,
    because the pause lives on `update_schedules` and joining it would trade a
    readable filter for a nested select that does the same thing.
  */
  const memberIds = [...new Set(due.map((u) => u.member_id as string))];
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

  const today = now.toISOString().slice(0, 10);
  const pausedUntil = new Map(
    (schedules ?? []).map((s) => [
      s.member_id as string,
      s.paused_until as string | null,
    ])
  );
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  let sent = 0;

  for (const update of due) {
    const memberId = update.member_id as string;
    const profile = profileById.get(memberId);
    const discordId = profile?.discord_user_id as string | undefined;

    // No Discord, or paused for academics — nothing owed and nothing to send.
    const paused = pausedUntil.get(memberId);
    if (!discordId || (paused && paused > today)) continue;

    // Written first. A crash after this costs one missed nudge; the other
    // order costs a duplicate on every retry.
    const { error: markError } = await supabase
      .from("progress_updates")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", update.id)
      .is("reminder_sent_at", null)
      .select();

    if (markError) continue;

    const name =
      (profile?.preferred_name as string) ||
      (profile?.full_name as string) ||
      "there";
    const hours = Math.max(
      1,
      Math.round(
        (Date.parse(update.due_at as string) - now.getTime()) / 3_600_000
      )
    );

    const ok = await sendDiscordDM(
      discordId,
      `Hi ${name} — your check-in is due in about ${hours} ${hours === 1 ? "hour" : "hours"}.\n` +
        `A line per project is enough, and "I'm stuck on X" is a perfectly good check-in.\n` +
        `${appUrl()}/my-work`
    );
    if (ok) sent++;
  }

  return NextResponse.json({ ok: true, considered: due.length, sent });
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
