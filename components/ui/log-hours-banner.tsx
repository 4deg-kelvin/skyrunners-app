import Link from "next/link";
import { Clock } from "lucide-react";

/**
 * "You haven't logged any hours yet" — once, until they do.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth a banner
 * ---------------------------------------------------------------------------
 *
 * Logging hours is the one habit the whole app rests on, and it is the habit
 * nothing in a student's life has taught them. Everything downstream is built
 * on it: check-ins pre-fill from logged hours, the commitment tier IS hours per
 * in-session week, and the Delivered signal sits next to an effort figure that
 * reads zero. A member can do six weeks of real work and have a record that says
 * they did nothing — and the record is what a Lead sees.
 *
 * That failure is completely silent. Nobody is told they're invisible; they just
 * are. Which is exactly the case a banner is for, and exactly the case a
 * reminder buried on one page is not.
 *
 * ---------------------------------------------------------------------------
 * Not on day one
 * ---------------------------------------------------------------------------
 *
 * A new member's first visit already asks them to connect Discord, and there is
 * nothing honest to nag about before they have done any work. So it waits a day.
 *
 * No cron and no scheduled job: this is a comparison between `joinedAt` and
 * today, evaluated when the page renders. The condition changes by itself as
 * time passes, which is the whole reason to express a delay as a date
 * comparison rather than something that has to fire.
 *
 * ---------------------------------------------------------------------------
 * It clears on the first log, and never comes back
 * ---------------------------------------------------------------------------
 *
 * Deliberately keyed on "have you ever", not "have you recently". Somebody who
 * logged once in September and nothing since needs a different message, and
 * their Lead's review queue is the thing that says it. A banner that reappears
 * whenever somebody has a quiet fortnight is a banner people learn to look past.
 */
export function LogHoursBanner() {
  return (
    <div className="border-cardinal-200 bg-cardinal-50 border-b">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <Clock className="text-cardinal-600 size-4 shrink-0" />
        <p className="text-ink min-w-0 text-sm">
          <span className="font-semibold">
            You haven&apos;t logged any hours yet.
          </span>{" "}
          <span className="text-ink-soft">
            Log them every time you work on something for the club, however
            small — it takes about ten seconds. It&apos;s how your effort shows
            up at all: your check-ins fill themselves in from it, and without it
            your record reads as nothing no matter how much you&apos;ve done.
          </span>
        </p>
        <Link
          href="/my-work"
          className="text-cardinal-600 hover:text-cardinal-700 text-sm font-bold whitespace-nowrap"
        >
          Log hours →
        </Link>
      </div>
    </div>
  );
}
