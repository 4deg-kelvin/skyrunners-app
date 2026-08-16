import Link from "next/link";
import { Clock } from "lucide-react";

/**
 * "You haven't logged any work yet" — once, until they do.
 *
 * Called `LogHoursBanner` until the tiers went, and it kept asking members for
 * hours for a while after there was anywhere to put them: it is rendered by the
 * app shell on every page, so it was simultaneously the most-read copy in the
 * product and the easiest thing to miss when grepping for a model field. Worth
 * remembering that a component whose NAME contains a deleted concept is how a
 * removal ends up half-done.
 *
 * ---------------------------------------------------------------------------
 * Why this is worth a banner
 * ---------------------------------------------------------------------------
 *
 * Logging what you did is the one habit the whole app rests on, and it is the
 * habit nothing in a student's life has taught them. Everything downstream is
 * built on it: check-ins pre-fill from the log, and the Delivered signal sits
 * beside a record that reads empty. A member can do six weeks of real work and
 * have a record that says they did nothing — and the record is what a Lead sees.
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
export function LogWorkBanner() {
  return (
    <div className="border-cardinal-200 bg-cardinal-50 border-b">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5 sm:px-8">
        <Clock className="text-cardinal-600 size-4 shrink-0" />
        <p className="text-ink min-w-0 text-sm">
          <span className="font-semibold">
            You haven&apos;t logged any work yet.
          </span>{" "}
          <span className="text-ink-soft">
            Write a line every time you work on something, however small — ten
            seconds. Your check-ins fill themselves in from it, and without it
            your record reads as nothing.
          </span>
        </p>
        <Link
          href="/my-work"
          className="text-cardinal-600 hover:text-cardinal-700 text-sm font-bold whitespace-nowrap"
        >
          Log what you did →
        </Link>
      </div>
    </div>
  );
}
