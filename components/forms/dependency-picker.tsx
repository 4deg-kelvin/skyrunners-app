"use client";

import { useState } from "react";
import { Link2, Link2Off, TriangleAlert } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { addDependencyAction, removeDependencyAction } from "@/lib/actions";
import { formatDay } from "@/lib/dates";
import type { DependencyEndKind } from "@/lib/types";

/** One already-declared link, as the page resolved it. */
export interface DependencyRow {
  id: string;
  targetName: string;
  targetKind: DependencyEndKind;
  targetHref?: string;
  targetDate?: string;
  targetDone: boolean;
  note?: string;
  conflict?: { days: number; waitingUntil: string };
}

/**
 * Declare and remove "this waits on that", from the edit panel.
 *
 * ---------------------------------------------------------------------------
 * Why it saves immediately, outside the surrounding form
 * ---------------------------------------------------------------------------
 *
 * It renders INSIDE the edit panel but OUTSIDE its `ActionForm`, because a
 * `<form>` inside a `<form>` is invalid HTML and React will not save you from
 * it. Each add and each remove is therefore its own write, landing the moment
 * you press it rather than on "Save changes".
 *
 * That turned out to be the better behaviour anyway. A dependency is a fact
 * about two things, not a field of one, and batching it into the project's save
 * would mean a failed name validation silently discarding a link you had
 * already chosen. The heading says so, because a control that saves on a
 * different schedule from the panel around it has to admit that.
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does NOT do
 * ---------------------------------------------------------------------------
 *
 * No date arithmetic, no reordering, no "earliest start". The conflict warning
 * is computed once on the server by `resolveDependencies` and passed in, so the
 * panel here, the list on the page and the mark on the timeline can never
 * disagree about whether something is late. See `lib/dependencies.ts`.
 */
export function DependencyPicker({
  dependentKind,
  dependentId,
  current,
  projectOptions,
  deliverableOptions = [],
  scopeRootName,
}: {
  dependentKind: DependencyEndKind;
  dependentId: string;
  /** Already declared, resolved and date-checked by the server. */
  current: DependencyRow[];
  /** Projects in scope, already filtered for this dependent's kind. */
  projectOptions: { id: string; name: string }[];
  /** Deliverables in scope, attributed when they live on another project. */
  deliverableOptions?: { id: string; title: string; projectName?: string }[];
  /**
   * The top-level project scope is confined to, when that isn't this project.
   *
   * Named in the copy rather than left implicit: "nothing here" is a puzzle,
   * and "nothing else under DroneHacks yet" is an answer.
   */
  scopeRootName?: string;
}) {
  const [adding, setAdding] = useState(false);

  const hasOptions = projectOptions.length > 0 || deliverableOptions.length > 0;

  return (
    <div className="border-line mt-4 border-t pt-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink text-sm font-bold">Waiting on</p>
        {hasOptions ? (
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-ink-muted hover:text-cardinal-600 inline-flex items-center gap-1 text-xs font-semibold transition-colors"
          >
            <Link2 className="size-3.5" />
            {adding ? "Cancel" : "Add a dependency"}
          </button>
        ) : null}
      </div>

      <p className="text-ink-muted mt-1 text-xs">
        Saves as you go — separately from the rest of this panel. Shows on the
        timeline as a tick where the awaited date lands.
        {scopeRootName ? <> Reaches anything under {scopeRootName}.</> : null}
      </p>

      {current.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5">
          {current.map((row) => (
            <li
              key={row.id}
              className="rounded-tile border-line bg-card flex flex-wrap items-start justify-between gap-2 border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-ink text-sm font-semibold">
                  {row.targetHref ? (
                    <a
                      href={row.targetHref}
                      className="hover:text-cardinal-600 transition-colors"
                    >
                      {row.targetName}
                    </a>
                  ) : (
                    row.targetName
                  )}
                  <span className="text-ink-muted ml-1.5 text-xs font-medium">
                    {row.targetKind === "project" ? "project" : "deliverable"}
                  </span>
                </p>

                {/*
                  The conflict, said in words as well as drawn on the chart.

                  Nothing is blocked by it — the club chose warn-not-enforce, so
                  a stale link cannot deadlock a sign-off. It reads as a fact
                  about two dates rather than an accusation, because the fix is
                  often to move one of them.
                */}
                {row.conflict ? (
                  <p className="text-risk-fg mt-0.5 flex items-start gap-1 text-xs font-medium">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    Lands {formatDay(row.conflict.waitingUntil)} —{" "}
                    {row.conflict.days} day
                    {row.conflict.days === 1 ? "" : "s"} after this is due.
                  </p>
                ) : row.targetDone ? (
                  <p className="text-ok-fg mt-0.5 text-xs font-medium">
                    Done — nothing to wait for.
                  </p>
                ) : row.targetDate ? (
                  <p className="text-ink-muted mt-0.5 text-xs">
                    Due {formatDay(row.targetDate)}
                  </p>
                ) : (
                  <p className="text-ink-muted mt-0.5 text-xs">No date set</p>
                )}

                {row.note ? (
                  <p className="text-ink-soft mt-1 text-xs italic">
                    {row.note}
                  </p>
                ) : null}
              </div>

              <ActionButton
                action={removeDependencyAction}
                fields={{ dependencyId: row.id }}
                tone="quiet"
                label="Remove"
                pendingLabel="Removing…"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted mt-2 text-xs">
          Nothing yet.{" "}
          {hasOptions
            ? "Add one if this can't start until something else lands."
            : /*
                No eligible target is a real state, not an error: a top-level
                project with no sub-projects and no deliverables elsewhere in
                its tree genuinely has nothing to wait on. Saying why beats an
                empty dropdown, and naming the tree says where to look.
              */
              `Nothing to wait on yet — a dependency reaches other work under ${scopeRootName ?? "this top-level project"}, not into another one.`}
        </p>
      )}

      {adding ? (
        <ActionForm
          action={addDependencyAction}
          submitLabel="Save dependency"
          submittingLabel="Saving…"
          className="rounded-tile border-line bg-card mt-2.5 border p-3"
          resetOnSuccess
          onSuccess={() => setAdding(false)}
        >
          <input type="hidden" name="dependentKind" value={dependentKind} />
          <input type="hidden" name="dependentId" value={dependentId} />

          <label className="block">
            <span className="text-ink mb-1 block text-xs font-semibold">
              What does it wait on?
            </span>
            {/*
              ONE select holding both kinds, with the kind encoded in the value.

              Two selects would let somebody pick in both and leave the server
              guessing, and a kind radio plus a dependent select is three
              controls for one choice. `optgroup` labels which is which.
            */}
            <select
              name="target"
              required
              defaultValue=""
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Pick one…
              </option>
              {deliverableOptions.length ? (
                <optgroup label="Deliverables">
                  {deliverableOptions.map((d) => (
                    <option key={d.id} value={`deliverable:${d.id}`}>
                      {d.projectName
                        ? `${d.title} — ${d.projectName}`
                        : d.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {projectOptions.length ? (
                <optgroup label="Projects">
                  {projectOptions.map((p) => (
                    <option key={p.id} value={`project:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>

          <label className="mt-2.5 block">
            <span className="text-ink mb-1 block text-xs font-semibold">
              Why? <span className="text-ink-muted font-medium">Optional</span>
            </span>
            <input
              type="text"
              name="note"
              maxLength={300}
              placeholder="Can't machine the mould until the drawing is signed off"
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
          </label>
        </ActionForm>
      ) : null}

      {/*
        The reverse view is NOT offered here.

        "What waits on me" is shown read-only on the project page, because it is
        somebody else's declaration: being able to delete it from this side would
        let a PL silently drop a warning another project is relying on.
      */}
      <p className="sr-only">
        <Link2Off className="size-3" aria-hidden /> Removing a dependency
        deletes it for everyone.
      </p>
    </div>
  );
}
