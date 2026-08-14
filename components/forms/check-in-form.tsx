"use client";

import { useState } from "react";
import { PenLine, X } from "lucide-react";

import { ActionForm, ActionButton } from "./action-form";
import { setPauseAction, submitCheckInAction } from "@/lib/actions";

export interface CheckInSection {
  projectId: string;
  projectName: string;
  /**
   * Pre-filled from this project's work-log entries for the period. Empty when
   * nothing was logged.
   */
  draftProgress: string;
  /** How many entries the draft came from, for the "from your log" note. */
  loggedCount: number;
  /**
   * Nothing was logged here, so this is the box the member has to write.
   * `submitCheckIn` refuses on the same condition — see `lib/checkin-draft.ts`.
   */
  needsWriting: boolean;
}

/**
 * Writing your twice-weekly check-in.
 *
 * ---------------------------------------------------------------------------
 * The form fills itself in
 * ---------------------------------------------------------------------------
 *
 * One section per project, PRE-FILLED from what the member logged against that
 * project since their last check-in. They edit and send rather than recalling a
 * week from memory, and that difference is what decides whether check-ins get
 * written at all.
 *
 * The pre-filled text is deliberately EDITABLE. The log is raw notes a member
 * wrote for themselves; the check-in is what they want their Lead to read. A
 * read-only summary would make this a receipt rather than a draft.
 *
 * A project with nothing logged gets an empty box marked required — and it is
 * the only required field on the form. That asymmetry is the whole design:
 * **the app asks exactly one question, about the one project it knows nothing
 * about.** Blockers and next steps stay optional everywhere; a form with three
 * required boxes per project, times three projects, is a form people skip.
 */
export function CheckInForm({
  sections,
  dueLabel,
  readerName,
}: {
  sections: CheckInSection[];
  /**
   * When it's due, already phrased — "check-in, due today", "check-in, 2 days
   * late". Built by `checkInDue` in `lib/labels.ts` rather than here, because
   * display strings live there and a client component shouldn't be deciding
   * what today is.
   */
  dueLabel: string;
  /**
   * Who actually reads this. Undefined when the member has nobody above them
   * — Co-Leads are at the top of the chain, so their check-ins go sideways to
   * the other Co-Leads rather than up. Saying "your Lead" to someone with no
   * Lead is the kind of small lie that makes people stop trusting the app.
   */
  readerName?: string;
}) {
  const [open, setOpen] = useState(false);

  const prefilled = sections.filter((s) => !s.needsWriting).length;
  const blank = sections.filter((s) => s.needsWriting).length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
      >
        <PenLine className="size-4" strokeWidth={2.5} />
        Write my check-in
      </button>
    );
  }

  return (
    <div className="rounded-card border-line bg-card border p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-ink text-[15px] font-bold">Your {dueLabel}</p>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-tile text-ink-muted hover:bg-surface p-1"
        >
          <X className="size-4" />
        </button>
      </div>
      {/*
        Say that there is one box PER PROJECT, before showing three of them.

        The composer repeats every project the page has already listed further
        up, which reads as the page showing everything twice unless something
        explains why. It isn't duplication — each box is a separate answer that
        lands on that project's own feed — but the reader has no way to know
        that from three identical-looking panels.
      */}
      {/*
        Say what has ALREADY been done for them, before showing the boxes.

        Without this line the composer looks like the same wall of empty fields
        it has always been, and the member scrolls past the pre-filled text
        without registering that it came from their own log. The count is what
        makes it credible.
      */}
      <p className="text-ink-muted mb-4 text-sm">
        {prefilled > 0 ? (
          <>
            <span className="text-ink font-semibold">
              {prefilled === 1
                ? "One section is already written"
                : prefilled + " sections are already written"}
            </span>{" "}
            from your work log — edit anything that needs it.{" "}
            {blank > 0
              ? (blank === 1
                  ? "One project has nothing logged, so that box is"
                  : blank +
                    " projects have nothing logged, so those boxes are") +
                " yours to fill in."
              : "Nothing else is needed."}
          </>
        ) : (
          <>
            One box per project you&apos;re on — a line in each is enough. Log
            as you go and these fill themselves in next time.
          </>
        )}{" "}
        {readerName
          ? `${readerName} reads this to start a conversation, not to grade you.`
          : "You're at the top of the reporting chain, so this goes to the other Co-Leads — same cadence as everyone else."}
      </p>

      <ActionForm
        action={submitCheckInAction}
        submitLabel={readerName ? "Send to my Lead" : "Send to the Co-Leads"}
        submittingLabel="Sending…"
        className="space-y-4"
      >
        {sections.length === 0 ? (
          <p className="rounded-tile bg-surface text-ink-soft px-3.5 py-3 text-sm">
            {/*
              Now only reachable when somebody is on NO projects at all.
              It used to appear whenever you hadn't logged hours, which meant
              the person with most to report — blocked, stuck, waiting on a
              part — was the one told they had nothing to say.
            */}
            You&apos;re not on any projects yet, so there&apos;s nothing
            project-specific to report. Leave a general note below, or find
            something to join.
          </p>
        ) : (
          sections.map((s) => (
            /*
              A RECESSED panel per project, with raised inputs inside it.

              This used to be a transparent box on the card, bordered in
              `border-line` — the same colour as the borders of the inputs
              inside it, on the same `bg-card` background. In dark mode those
              two values are four points apart, so the whole composer read as
              one undifferentiated stack of boxes and you could not tell where
              one project ended and the next began.

              `bg-surface` is the page colour, so each project sits a step BACK
              from the card and the fields sit forward of it. Figure and ground,
              rather than eleven identical rectangles.
            */
            <div
              key={s.projectId}
              className="rounded-tile border-line bg-surface border px-3.5 py-3"
            >
              {/* Repeated field carrying the project id, so the action can
                  reconstruct a variable number of sections from flat FormData. */}
              <input type="hidden" name="projectId" value={s.projectId} />

              {/*
                The project name as a section label, not body text.

                Every other card in the app orients you with a small uppercase
                cardinal label before the content. These panels had the project
                name at the same weight as the words inside them, which is why
                the page read as a wall — nothing said "a new thing starts
                here".
              */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-cardinal-600 text-[11px] font-semibold tracking-[0.1em] uppercase">
                  {s.projectName}
                </span>
                {/*
                  Which of the two states this box is in, said plainly.

                  "Needs a line" is a request, not a warning — somebody who did
                  nothing on a project because they were blocked or buried in
                  midterms is having a normal week, and hearing about it is the
                  entire reason this box is required.
                */}
                {s.needsWriting ? (
                  <span className="text-ink-muted text-xs font-semibold">
                    Nothing logged — needs a line
                  </span>
                ) : (
                  <span className="bg-ok-bg text-ok-fg rounded-full px-2 py-0.5 text-xs font-bold">
                    {s.loggedCount === 1
                      ? "From your log"
                      : `From ${s.loggedCount} log entries`}
                  </span>
                )}
              </div>

              <label className="mt-2 block">
                <span className="sr-only">Progress on {s.projectName}</span>
                {/*
                  `defaultValue`, not `value` — an uncontrolled field on purpose.
                  The draft is a starting point the member types over, and making
                  it controlled would need state here for no benefit.

                  `required` only where nothing was logged. The server enforces
                  the same rule from the same function (`workByProject`), so this
                  can't demand a box the server would accept, or accept one it
                  would refuse with a message the page never showed.
                */}
                <textarea
                  name={`progress:${s.projectId}`}
                  rows={s.needsWriting ? 2 : 3}
                  required={s.needsWriting}
                  defaultValue={s.draftProgress}
                  placeholder={
                    s.needsWriting
                      ? "Blocked? Waiting on a part? Buried in midterms? Any of those is a real answer."
                      : "What moved forward?"
                  }
                  className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
                />
              </label>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  name={`blockers:${s.projectId}`}
                  placeholder="Anything blocking you? (optional)"
                  className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  name={`nextSteps:${s.projectId}`}
                  placeholder="Next steps (optional)"
                  className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
                />
              </div>
            </div>
          ))
        )}

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Anything else{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <textarea
            name="generalNote"
            rows={2}
            placeholder="Not tied to one project — availability, questions, anything."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>

        <p className="text-ink-muted text-xs">
          The per-project notes appear on those projects, where anyone can see
          them. Your reliability record stays between you and your Lead.
        </p>
      </ActionForm>
    </div>
  );
}

/** Pause / resume the check-in obligation. */
export function PauseControls({ pausedUntil }: { pausedUntil?: string }) {
  if (pausedUntil) {
    return (
      <ActionButton
        action={setPauseAction}
        fields={{ weeks: "0" }}
        label="Resume my check-ins"
        pendingLabel="Resuming…"
        tone="primary"
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <ActionButton
        action={setPauseAction}
        fields={{ weeks: "1" }}
        label="Pause 1 week"
        pendingLabel="Pausing…"
      />
      <ActionButton
        action={setPauseAction}
        fields={{ weeks: "2" }}
        label="Pause 2 weeks"
        pendingLabel="Pausing…"
      />
    </div>
  );
}
