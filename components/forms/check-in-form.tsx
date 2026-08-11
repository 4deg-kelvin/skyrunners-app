"use client";

import { useState } from "react";
import { PenLine, X } from "lucide-react";

import { ActionForm, ActionButton } from "./action-form";
import { setPauseAction, submitCheckInAction } from "@/lib/actions";
import { formatNumber } from "@/lib/utils";

export interface CheckInSection {
  projectId: string;
  projectName: string;
  hours: number;
  /** Whatever they wrote last time, shown as a prompt, never pre-filled. */
  lastProgress?: string;
}

/**
 * Writing your twice-weekly check-in.
 *
 * One section per project, seeded from the hours already logged — which is the
 * whole reason hours logging came first. The member confirms and annotates
 * rather than recalling a week from memory, and that difference is what decides
 * whether check-ins actually get written.
 *
 * Only `progress` is offered per project by default; blockers and next steps are
 * there but optional. A form with three required boxes per project, times three
 * projects, is a form people skip.
 *
 * Hours are displayed but NOT editable here — the server recomputes them from
 * work logs. They're a record, not a claim.
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
      <p className="text-ink-muted mb-4 text-sm">
        One box per project you&apos;re on — a line in each is enough, and you
        can leave any of them blank.{" "}
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
                <span
                  className={
                    s.hours > 0
                      ? "bg-ok-bg text-ok-fg rounded-full px-2 py-0.5 text-xs font-bold"
                      : "text-ink-muted text-xs"
                  }
                >
                  {formatNumber(s.hours, 1)} hrs logged
                </span>
              </div>

              <label className="mt-2 block">
                <span className="sr-only">Progress on {s.projectName}</span>
                <textarea
                  name={`progress:${s.projectId}`}
                  rows={2}
                  placeholder={
                    s.lastProgress
                      ? `Last time: ${s.lastProgress.slice(0, 70)}…`
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
          them. Your total hours and reliability stay between you and your Lead.
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
