"use client";

import { useState } from "react";
import { ArrowRight, CircleDot, Flag, Layers, Loader2, X } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { setProjectPhaseAction } from "@/lib/actions";
import { PHASE_LABELS, PHASE_ORDER } from "@/lib/labels";
import { phaseOptions } from "@/lib/phase-control";
import type { ProjectPhase } from "@/lib/types";

/**
 * Change a project's phase, and mark it complete, without opening the editor.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * Advancing the phase was only possible through "Edit project": open a dialog
 * holding the name, description, target date and open-roles text, find the
 * phase select among them, change it, save. Four interactions and a modal, for
 * the most routine update a PL makes — and a dialog that also lets you rewrite
 * the project's name is a strange place to be nudged into weekly.
 *
 * It also made completing a project feel like an edit rather than a decision,
 * which it is not: `can.completeProject` is a NARROWER right than
 * `can.manageProject` and deliberately excludes the project's own PL. Burying
 * it in the same form as the description hides that distinction entirely.
 *
 * ---------------------------------------------------------------------------
 * Two controls, because there are two different actions
 * ---------------------------------------------------------------------------
 *
 *   1. **Advance one step** — one click, naming the destination ("Move to
 *      Integration"). Phases go forward, in order, nearly always.
 *   2. **The whole list** — behind a quiet "Change phase" button, for jumping
 *      and for coming back OUT of complete when work restarts.
 *
 * The advance button is withheld when the next step is `complete` and the
 * viewer may not complete it, because the honest one-click action there belongs
 * to somebody else. The list still shows Complete, with the reason it is
 * unavailable, so the rule is discoverable rather than simply missing.
 *
 * Naming over loudness, per the lesson in `push-deadline.tsx`: quiet text that
 * says what it does, not a filled button competing with "Edit project".
 */
export function ProjectPhaseControl({
  projectId,
  phase,
  canComplete,
  incompleteDescendants,
}: {
  projectId: string;
  phase: ProjectPhase;
  /**
   * Whether this viewer holds `can.completeProject` — a PL above this project,
   * its Division Lead, or a Co-Lead. Not the project's own PL.
   *
   * Passed in rather than derived: `can.*` needs the graph, and this is a
   * Client Component.
   */
  canComplete: boolean;
  /**
   * Names of unfinished sub-projects. Completing is refused while any exists,
   * and `ops.updateProject` enforces that regardless — this only lets the
   * control say so up front rather than after a click.
   */
  incompleteDescendants: string[];
}) {
  const [open, setOpen] = useState(false);

  /*
    The decisions live in `lib/phase-control.ts`, not here.

    This popover only exists after hydration, so nothing that fetches the page
    can check what the list says — which would leave these rules verifiable
    only by hand. Pure module, tested; see its header.
  */
  const {
    advanceTo: next,
    mayComplete: mayCross,
    blockedReason: completeBlockedReason,
  } = phaseOptions({ phase, canComplete, incompleteDescendants });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {next ? (
        <ActionButton
          action={setProjectPhaseAction}
          fields={{ projectId, phase: next }}
          tone={next === "complete" ? "default" : "quiet"}
          label={
            next === "complete"
              ? "Mark it complete"
              : `Move to ${PHASE_LABELS[next]}`
          }
          pendingLabel="Saving…"
        />
      ) : null}

      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-ink-muted hover:text-cardinal-600 inline-flex items-center gap-1 text-xs font-semibold transition-colors"
        >
          <Layers className="size-3.5" />
          Change phase
        </button>

        {open ? (
          /*
            Anchored LEFT and viewport-capped, for the measured reason recorded
            on the push-deadline panel: this sits at the left edge of the Status
            card, so rightward is the only direction with room.
          */
          <div className="rounded-tile border-line bg-card absolute left-0 z-10 mt-2 w-[17.5rem] max-w-[calc(100vw-3rem)] border p-2 shadow-lg">
            <div className="mb-1 flex items-start justify-between gap-2 px-1.5 pt-1">
              <p className="text-ink text-sm font-bold">Phase</p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-tile text-ink-muted hover:bg-surface -mt-1 p-1"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="text-ink-muted mb-2 px-1.5 text-xs">
              Where the project is in its lifecycle. Separate from how it&apos;s
              going — that&apos;s health, on the badge.
            </p>

            <ul className="space-y-0.5">
              {PHASE_ORDER.map((option) => {
                const isCurrent = option === phase;

                /*
                  Complete, when this person can't. Rendered as text rather than
                  a disabled button: a greyed row invites clicking to find out
                  why, and the reason is the useful part.
                */
                if (option === "complete" && !mayCross) {
                  return (
                    <li key={option} className="px-1.5 py-1">
                      <p className="text-ink-muted flex items-center gap-2 text-sm font-semibold">
                        <Flag className="size-3.5 shrink-0" />
                        {PHASE_LABELS[option]}
                      </p>
                      <p className="text-ink-muted mt-0.5 pl-[1.375rem] text-xs">
                        {completeBlockedReason}
                      </p>
                    </li>
                  );
                }

                return (
                  <li key={option}>
                    <ActionForm
                      action={setProjectPhaseAction}
                      onSuccess={() => setOpen(false)}
                      renderSubmit={(pending) => (
                        <button
                          type="submit"
                          disabled={pending || isCurrent}
                          className={
                            isCurrent
                              ? "rounded-tile text-ink flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm font-bold"
                              : "rounded-tile text-ink-soft hover:bg-surface hover:text-ink flex w-full items-center gap-2 px-1.5 py-1.5 text-left text-sm font-medium transition-colors disabled:opacity-60"
                          }
                        >
                          {pending ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin" />
                          ) : isCurrent ? (
                            <CircleDot className="text-cardinal-600 size-3.5 shrink-0" />
                          ) : option === "complete" ? (
                            <Flag className="size-3.5 shrink-0" />
                          ) : (
                            <ArrowRight className="size-3.5 shrink-0 opacity-30" />
                          )}
                          {PHASE_LABELS[option]}
                          {isCurrent ? (
                            <span className="text-ink-muted ml-auto text-xs font-medium">
                              now
                            </span>
                          ) : null}
                        </button>
                      )}
                    >
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="phase" value={option} />
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
