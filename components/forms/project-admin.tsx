"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  addProjectMemberAction,
  createProjectAction,
  setProjectREAction,
} from "@/lib/actions";

export interface Option {
  id: string;
  name: string;
}

/**
 * Create a project.
 *
 * Permissions here are deliberately permissive (see `can.createProject`): any
 * Lead can start a top-level project, and a PL can start one inside their own
 * subtree. Making project creation feel heavyweight is how a club ends up
 * tracking real work in a side document instead.
 *
 * The PL defaults to the creator, because a project with no accountable person
 * is the one state the model cannot represent.
 */
export function CreateProjectForm({
  parents,
  divisions,
  people,
  defaultReId,
  parentId,
  parentTargetDate,
  defaultStartDate,
  label = "New project",
}: {
  parents: Option[];
  divisions: Option[];
  people: Option[];
  defaultReId: string;
  /** Fixed parent — used for "add a sub-project" on a project page. */
  parentId?: string;
  /**
   * The fixed parent's target date, if it has one. Work inside a project
   * can't be due after it, and `createProject` refuses that — this caps the
   * picker so you find out before pressing the button rather than after.
   */
  parentTargetDate?: string;
  /**
   * What to pre-fill the start date with, for a sub-project.
   *
   * Computed on the SERVER as the later of the parent's start and today —
   * `laterDay` in `lib/dates.ts`. Passed in already resolved rather than
   * derived here from a `parentStartDate`, because "today" is a question about
   * the club's timezone: this is a Client Component, so a `new Date()` here
   * would answer it in the reader's browser, and the app is emphatic that
   * dates go through `lib/dates.ts` for exactly that reason.
   */
  defaultStartDate?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        {label}
      </button>
    );
  }

  return (
    <ActionForm
      action={createProjectAction}
      submitLabel="Create project"
      submittingLabel="Creating…"
      resetOnSuccess
      className="rounded-card border-line bg-card w-full border p-4 text-left"
    >
      {parentId ? (
        <input type="hidden" name="parentId" value={parentId} />
      ) : null}

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">Name</span>
        <input
          type="text"
          name="name"
          required
          placeholder="Tail Boom Redesign"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          What is it?{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={2}
          placeholder="One sentence someone browsing Projects would understand."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Project Lead
          </span>
          <select
            name="primaryReId"
            defaultValue={defaultReId}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-ink-muted mt-1 block text-xs">
            Accountable for the deliverables. Can be changed later.
          </span>
        </label>

        {/*
          Start date, asked for rather than assumed.

          `createProject` has taken a `startDate` since it was written and
          nothing ever passed one, so every project claimed to have begun the
          afternoon somebody typed it in. Wrong in both directions: work the
          club has been running for a month reads as brand new, and work that
          starts after finals reads as already underway — and the timeline draws
          both from this date, so a wrong one is visibly wrong.

          For a TOP-LEVEL project this is left EMPTY. A blank field is a
          question; today's date is an answer somebody has to notice is wrong.
          `startDateFor` still falls back to today when it is blank, so nothing
          breaks and skipping the field gives the old behaviour.

          A SUB-PROJECT gets a real suggestion, because there is one to make:
          the later of its parent's start and today.

            parent began in the PAST     -> today. The sub-project is being
                                            created now; claiming it started
                                            when its parent did would draw
                                            weeks of work that never happened.
            parent has NOT begun yet     -> the parent's start. Work inside a
                                            project cannot get going before the
                                            project does, so today would be the
                                            wrong answer and visibly so on the
                                            timeline.

          Suggested, NOT enforced. `updateProject` deliberately carries no
          parent/child start-date rule — see CLAUDE.md §11 — because prep work
          on a sub-task legitimately begins before its parent, and this field
          stays editable to say so.
        */}
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Start date{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="date"
            name="startDate"
            defaultValue={defaultStartDate ?? ""}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            {defaultStartDate
              ? "The later of the project above's start and today. Change it if this really begins on another day."
              : "When the work actually begins. Leave it empty for today — set it if this started earlier, or hasn't started yet."}
          </span>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Target date{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          {/*
            A sub-project starts on its parent's date — see the longer note in
            `project-edit.tsx`. Still optional: clear it and the project is
            created undated, exactly as before.
          */}
          <input
            type="date"
            name="targetDate"
            defaultValue={parentTargetDate ?? ""}
            max={parentTargetDate}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          {parentTargetDate ? (
            <span className="text-ink-muted mt-1 block text-xs">
              Filled in from the project above, which is due {parentTargetDate}.
              Pick an earlier date if this lands sooner.
            </span>
          ) : null}
        </label>
      </div>

      {!parentId ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Division
            </span>
            <select
              name="teamId"
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            >
              <option value="">— pick one —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span className="text-ink-muted mt-1 block text-xs">
              Without one it won&apos;t show up grouped on Projects.
            </span>
          </label>

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Sits under{" "}
              <span className="text-ink-muted font-normal">(optional)</span>
            </span>
            <select
              name="parentId"
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
            >
              <option value="">Top level</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mt-3 ml-5 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/** Add someone to a project, optionally as a PL. */
export function AddProjectMemberForm({
  projectId,
  candidates,
  canAssignRE,
}: {
  projectId: string;
  candidates: Option[];
  canAssignRE: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
      >
        <Plus className="size-3.5" strokeWidth={2.5} />
        Add member
      </button>
    );
  }

  return (
    <ActionForm
      action={addProjectMemberAction}
      submitLabel="Add to project"
      submittingLabel="Adding…"
      resetOnSuccess
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">Who</span>
          <select
            name="memberId"
            required
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What they own{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="responsibility"
            placeholder="Structural analysis"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      {canAssignRE ? (
        <label className="text-ink mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="asRE" value="yes" className="mt-1" />
          <span>
            Make them a Project Lead
            <span className="text-ink-muted block text-xs">
              PL authority inherits down — they&apos;ll be able to manage this
              project and everything under it.
            </span>
          </span>
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mt-3 ml-5 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/** Promote to PL, demote, or hand over the primary role. */
export function REControls({
  projectId,
  memberId,
  isRE,
  isPrimary,
}: {
  projectId: string;
  memberId: string;
  isRE: boolean;
  isPrimary: boolean;
}) {
  if (isPrimary) {
    return <span className="text-ink-muted text-xs">Primary PL</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isRE ? (
        <>
          <ActionButton
            action={setProjectREAction}
            fields={{ projectId, memberId, mode: "primary" }}
            label="Make primary"
            pendingLabel="Saving…"
          />
          <ActionButton
            action={setProjectREAction}
            fields={{ projectId, memberId, mode: "remove" }}
            label="Remove PL"
            pendingLabel="Saving…"
            tone="danger"
          />
        </>
      ) : (
        <ActionButton
          action={setProjectREAction}
          fields={{ projectId, memberId, mode: "add" }}
          label="Make PL"
          pendingLabel="Saving…"
        />
      )}
    </div>
  );
}
