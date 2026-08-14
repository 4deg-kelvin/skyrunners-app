"use client";

import { useState } from "react";
import { Lock, Plus, X } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { deleteWorkAction, logWorkAction } from "@/lib/actions";
import type { WorkLog } from "@/lib/types";
import { formatDay } from "@/lib/dates";

/**
 * Quick-add for the work log, and the day-by-day view of it.
 *
 * Was `LogHoursForm`. The inversion is the point of the whole change: it used to
 * ask for a NUMBER and treat the note as optional, and now it asks for the note
 * and there is no number. The note is what the club actually wanted, and it was
 * the field people skipped.
 *
 * This is still the highest-frequency action in the app, and it still happens in
 * the lab, on a phone, at the end of a session when nobody wants to fill in a
 * form. So everything that can be pre-filled is:
 *
 *   - the date defaults to today
 *   - the project defaults to whichever you logged against last
 *
 * Which makes the common case two taps and a sentence. That sentence is no
 * longer busywork, and saying so is worth the line of copy: it lands in the
 * member's next check-in, pre-filled, and that is the only reason anyone would
 * bother. If logging gets slower than this, people stop — and now the check-in
 * gets harder for them too, because there's nothing to draft it from.
 *
 * Collapsed by default so it never competes with the page it sits on.
 */
export function LogWorkForm({
  projects,
  defaultProjectId,
  today,
  maxBackdateDays,
  recent,
}: {
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
  today: string;
  maxBackdateDays: number;
  /**
   * What they've already logged, grouped by day, newest day first.
   *
   * Logging used to be write-only — no screen in the app listed a single entry,
   * so `deleteWorkAction` had nothing to attach to and a wrong entry was
   * permanent. Correcting one belongs beside writing one.
   */
  recent?: {
    days: {
      day: string;
      entries: {
        log: WorkLog;
        project?: { name: string };
        locked: boolean;
      }[];
    }[];
    /**
     * True when the member has logged nothing in the last fortnight and the data
     * layer fell back to their last few entries whatever their age — the case
     * that matters for somebody returning after a break.
     */
    stale: boolean;
  };
}) {
  const [open, setOpen] = useState(false);

  const days = recent?.days ?? [];
  const stale = recent?.stale ?? false;

  /*
    No early return for "you're on no projects" any more.

    There used to be one, because the dropdown would have been empty. Misc
    changed that: somebody who turned up to an open build session and helped for
    an afternoon has something to log and no project — which is precisely the
    person the old message told to go away.
  */

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Log what I did
      </button>
    );
  }

  // The earliest date the server will accept. Set as `min` so the picker itself
  // prevents the mistake, rather than letting someone fill the form and get
  // rejected — same rule as the server, enforced twice.
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - maxBackdateDays);

  return (
    <div className="rounded-card border-line bg-card border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-ink text-[15px] font-bold">Log what I did</p>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-tile text-ink-muted hover:bg-surface p-1"
        >
          <X className="size-4" />
        </button>
      </div>

      <ActionForm
        action={logWorkAction}
        submitLabel="Log it"
        submittingLabel="Logging…"
        resetOnSuccess
        className="space-y-3"
      >
        {/*
          "What you did" comes FIRST and is the only required field.

          It used to be last and optional, under the number. Field order is the
          clearest statement a form makes about what it's for, and a note tucked
          beneath a required Hours box reads as an afterthought — which is
          exactly how it was treated.
        */}
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What did you do?
          </span>
          <textarea
            name="description"
            rows={2}
            required
            maxLength={500}
            placeholder="Mesh refinement on the spar model — first pass converged"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            A line is enough. This goes straight into your next check-in, so you
            won&apos;t have to write it twice.
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Project
            </span>
            <select
              name="projectId"
              defaultValue={defaultProjectId ?? projects[0]?.id}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {/*
                Misc, and it isn't a fallback for laziness.

                It follows from the calendar: somebody sees an open build
                session, turns up, and helps for an afternoon on a project they
                aren't committed to. That work is real. Without this the honest
                answer was impossible and logging it against the wrong project
                was the only way through — which is worse for a project's diary
                than an unattributed entry.

                Misc entries do NOT pre-fill any check-in section, since they
                belong to no project. `workByProject` drops them deliberately.
              */}
              <option value="">Misc — helped on something else</option>
            </select>
          </label>

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Date
            </span>
            <input
              type="date"
              name="workDate"
              defaultValue={today}
              min={earliest.toISOString().slice(0, 10)}
              max={today}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            />
            <span className="text-ink-muted mt-1 block text-xs">
              Up to {maxBackdateDays} days back.
            </span>
          </label>
        </div>
      </ActionForm>

      {days.length > 0 ? (
        <div className="border-line mt-4 border-t pt-3">
          {/*
            Two different headings for two different situations.

            Normally this list is for correcting a wrong entry. But when the last
            fortnight is empty the data layer falls back to the last few entries
            whatever their age — and for somebody back from midterms the useful
            question isn't "which of these is wrong", it's "what was I doing".
            Saying which one this is stops the older dates reading as stale data.
          */}
          <p className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
            {stale ? "Where you left off" : "Your log"}
          </p>

          {/*
            Grouped by DAY, with the date as a heading rather than repeated on
            every row.

            This is the diary half of the change. The old list was one flat run
            of "Project · Aug 5 · 2.5 hrs" lines, which is a timesheet however
            it's styled: the eye goes to the numbers and the dates repeat. With
            the day as a heading, a week reads as a narrative — which is the
            thing a member is actually trying to remember, and the thing their
            Lead is trying to understand.
          */}
          <div className="mt-2 space-y-3">
            {days.map(({ day, entries }) => (
              <div key={day}>
                {/*
                  The weekday is spelled out alongside the date, and that is not
                  decoration: people remember "I did that on Tuesday", not "I did
                  that on the 5th". `formatDay`'s options REPLACE its defaults
                  rather than merging, so all three parts have to be named here
                  or the heading silently becomes just "Tue".
                */}
                <p className="text-ink text-sm font-bold">
                  {formatDay(day, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>

                <ul className="mt-1 space-y-1.5">
                  {entries.map(({ log, project, locked }) => (
                    <li
                      key={log.id}
                      className="flex flex-wrap items-start justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="text-cardinal-600 text-xs font-semibold">
                          {project ? project.name : "Misc"}
                        </span>
                        {/*
                          The description on its own line, at full width. It used
                          to be one run-on string joined by middots, which on a
                          phone wrapped so the description — the only part that
                          says what actually happened — got truncated at the end.
                        */}
                        {log.description ? (
                          <span className="text-ink-soft mt-0.5 block">
                            {log.description}
                          </span>
                        ) : (
                          /*
                            Only reachable for rows written before the note was
                            required. Not backfilled: inventing text for a real
                            record is worse than admitting the gap.
                          */
                          <span className="text-ink-muted mt-0.5 block text-xs italic">
                            No note — logged before notes were required
                          </span>
                        )}
                      </span>

                      {/*
                        A locked row says so instead of offering a button that
                        would be refused. It's part of a check-in already sent,
                        and editing it afterwards would change a report somebody
                        has read.
                      */}
                      {locked ? (
                        <span className="text-ink-muted inline-flex shrink-0 items-center gap-1 text-xs">
                          <Lock className="size-3" />
                          In a sent check-in
                        </span>
                      ) : (
                        <ActionButton
                          action={deleteWorkAction}
                          fields={{ logId: log.id }}
                          label="Remove"
                          pendingLabel="Removing…"
                          tone="danger"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
