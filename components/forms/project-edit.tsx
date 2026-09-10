"use client";

import { useState } from "react";
import { Pencil, TriangleAlert, X } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { deleteProjectAction, updateProjectAction } from "@/lib/actions";
import { DependencyPicker, type DependencyRow } from "./dependency-picker";
import { HEALTH_LABELS, PHASE_LABELS, PHASE_ORDER } from "@/lib/labels";
import type { Project, ProjectHealth } from "@/lib/types";

const HEALTHS: ProjectHealth[] = ["on_track", "at_risk", "blocked"];

/**
 * Edit a project, and delete it.
 *
 * Phase and health are the two things most worth keeping current, and they are
 * different questions: phase is WHERE in the lifecycle this sits, health is HOW
 * IT'S GOING. Editing them is a dropdown rather than a bar to drag, because a
 * lifecycle stage is a fact somebody knows, not a percentage to estimate.
 *
 * Who can open this is decided by the caller via `can.manageProject`, which
 * means a PL of this project OR of anything above it in the project tree — PL
 * authority inherits downward. A PL of a sibling project cannot.
 */
export function ProjectEditForm({
  project,
  canDelete,
  canComplete,
  parentTargetDate,
  incompleteDescendants,
  dependencies,
  dependencyOptions,
}: {
  project: Project;
  /**
   * What this project waits on, and what it may wait on.
   *
   * Resolved and date-checked on the server, because the conflict comparison
   * must have exactly one implementation — see `resolveDependencies`. This is a
   * Client Component and cannot read the store anyway.
   */
  dependencies: DependencyRow[];
  dependencyOptions: {
    projects: { id: string; name: string }[];
    deliverables: { id: string; title: string; projectName?: string }[];
    rootName?: string;
  };
  canDelete: boolean;
  /**
   * May mark this complete — a NARROWER right than opening this form.
   *
   * The assigned PL edits everything here; only somebody above the project can
   * declare it finished. Hiding the option rather than letting the save fail:
   * a dropdown entry that always errors is a dead control, and the sentence
   * underneath says who to ask instead.
   */
  canComplete: boolean;
  /**
   * The parent's target date, if it has one. A sub-project can't be due after
   * the thing it's part of, so the date input is capped and says why. The
   * operation re-checks it — this is the half that stops you typing it.
   */
  parentTargetDate?: string;
  /**
   * Sub-projects at any depth that aren't complete.
   *
   * `updateProject` refuses a completion while this is non-empty. Showing it
   * here as the stage dropdown changes turns a rejection into a rule — you find
   * out what's in the way before you press save, and which projects they are.
   */
  incompleteDescendants: { id: string; name: string; slug: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [phase, setPhase] = useState(project.phase);

  const blockedFromCompleting =
    phase === "complete" &&
    project.phase !== "complete" &&
    incompleteDescendants.length > 0;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
      >
        <Pencil className="size-3.5" strokeWidth={2.5} />
        Edit project
      </button>
    );
  }

  return (
    <div className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5">
      {/*
        One exit, at the top right, where a panel's close control is looked for.

        There used to be a "Cancel" buried mid-panel, directly against the Save
        button with nothing between them — and by the time the dependency picker
        and the delete control were added below it, the only way out of an open
        panel was above the section you were working in. A close affordance has
        to be findable from the BOTTOM of a long panel too, which is what pinning
        it to the header gets: it is the last thing in the tab order to move
        backwards to, and it does not drift as the panel grows.

        Nothing is discarded by closing, and nothing needs to be: the fields
        below are uncommitted until Save, and each dependency has already
        written itself. Sticking a confirmation in front of that would be
        guarding nothing.
      */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-ink text-sm font-bold">Editing this project</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink hover:bg-card rounded-tile -mr-1 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors"
        >
          <X className="size-3.5" />
          Close
        </button>
      </div>

      <ActionForm
        action={updateProjectAction}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="projectId" value={project.id} />

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Name
          </span>
          <input
            type="text"
            name="name"
            required
            defaultValue={project.name}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What it is
          </span>
          <textarea
            name="description"
            rows={2}
            defaultValue={project.description ?? ""}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Stage
            </span>
            <select
              name="phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value as Project["phase"])}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            >
              {PHASE_ORDER.filter(
                // Already complete? Keep it, or saving any other edit would
                // silently demote the project.
                (p) =>
                  p !== "complete" ||
                  canComplete ||
                  project.phase === "complete"
              ).map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              How it&apos;s going
            </span>
            <select
              name="health"
              defaultValue={project.health}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            >
              {HEALTHS.map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABELS[h]}
                </option>
              ))}
            </select>
          </label>

          {/*
            Start date, editable — it was not, until 2026-09-09.

            `updateProject` did not accept one, so whatever `createProject`
            defaulted to on the day somebody typed the project in was permanent.
            The timeline's left edge is drawn from this, so a project entered
            three weeks late drew three weeks of work that had not happened.

            Pre-filled with the stored value and NOT with the parent's, unlike
            the target date below. A sub-project's target genuinely cannot be
            later than its parent's, so the parent's date is a real bound worth
            suggesting; there is no equivalent rule for starting, and prep work
            on a sub-task legitimately begins before its parent does. Suggesting
            a date that no rule requires is how a default becomes a wrong
            answer people accept.
          */}
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Start date
            </span>
            <input
              type="date"
              name="startDate"
              defaultValue={project.startDate ?? ""}
              max={project.targetDate}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
            <span className="text-ink-muted mt-1 block text-xs">
              When the work began, or begins. The timeline is drawn from this,
              so a real date is worth more than the day it was entered.
            </span>
          </label>

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Target date
            </span>
            {/*
              An undated sub-project pre-fills with its parent's date.

              A sub-project can't be due after the thing it's part of, so the
              parent's date is the latest this could honestly be — which makes
              it the right SUGGESTION and the wrong silent default. It is filled
              into the field, where it is visible and editable, and is written
              only when somebody presses Save. `createProject` and
              `updateProject` still accept no date at all; clearing the field
              works exactly as before.

              What this deliberately does NOT do is store a date nobody chose.
              A target date is a commitment somebody made, and the app already
              refuses to manufacture a record of something a person didn't say
              — see the ProjectNotice note in CLAUDE.md §10.
            */}
            <input
              type="date"
              name="targetDate"
              defaultValue={project.targetDate ?? parentTargetDate ?? ""}
              max={parentTargetDate}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
            {parentTargetDate ? (
              <span className="text-ink-muted mt-1 block text-xs">
                {project.targetDate
                  ? `Can't be after ${parentTargetDate} — the project above is due then.`
                  : `Filled in from the project above, which is due ${parentTargetDate}. Save to keep it, or pick an earlier date.`}
              </span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Help wanted
            </span>
            <input
              type="text"
              name="openRoles"
              defaultValue={project.openRoles ?? ""}
              placeholder="CFD, composites layup"
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
          </label>
        </div>

        {/*
          Said before the submit, not after it.
          The operation refuses this anyway — that's the real guard, since a
          Server Action is a POST endpoint the moment it exists. This is so the
          PL knows WHY and which sub-projects to chase, instead of pressing save
          and being told no.
        */}
        {blockedFromCompleting ? (
          <div className="rounded-tile border-warn-fg/25 bg-warn-bg mt-3 mb-2.5 border p-3">
            <p className="text-warn-fg flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">
                  {incompleteDescendants.length} sub-project
                  {incompleteDescendants.length === 1
                    ? " isn't"
                    : "s aren't"}{" "}
                  complete:
                </span>{" "}
                {incompleteDescendants.map((d) => d.name).join(", ")}. Marking
                this complete would hide{" "}
                {incompleteDescendants.length === 1 ? "it" : "them"} under a
                finished project, so it&apos;s refused — finish or move{" "}
                {incompleteDescendants.length === 1 ? "it" : "those"} first.
              </span>
            </p>
          </div>
        ) : null}

        {phase === "complete" && project.phase !== "complete" ? (
          <p className="text-ink-muted mt-3 mb-2.5 text-xs">
            Completing this posts a note in its updates feed and tells everyone
            above it: the PLs of any parent projects, the team leads, then the
            Division Lead. It stops there — Co-Leads aren&apos;t pinged for
            every finished project.
          </p>
        ) : null}

        {!canComplete && project.phase !== "complete" ? (
          <p className="text-ink-muted mt-3 text-xs">
            <span className="text-ink font-semibold">
              Marking this complete isn&apos;t yours to do.
            </span>{" "}
            You&apos;re accountable for finishing it; the PL above this project
            — or your Division Lead — reviews it and agrees it&apos;s done. Set
            the stage to flight test and tell them it&apos;s ready.
          </p>
        ) : null}

        <p className="text-ink-muted mt-3 mb-2.5 text-xs">
          Stage is where this sits in the lifecycle. How it&apos;s going is
          separate — a project can be at flight test and still blocked. Help
          wanted is matched against people&apos;s skills on Projects.
        </p>
      </ActionForm>

      {/*
        OUTSIDE the ActionForm above, and it has to be: a `<form>` inside a
        `<form>` is invalid HTML. Each dependency therefore saves on its own
        press rather than on "Save changes", which the picker's own subtitle
        admits.
      */}
      <DependencyPicker
        dependentKind="project"
        dependentId={project.id}
        current={dependencies}
        projectOptions={dependencyOptions.projects}
        deliverableOptions={dependencyOptions.deliverables}
        scopeRootName={dependencyOptions.rootName}
      />

      {canDelete ? (
        <div className="border-line mt-3 border-t pt-3">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton
                action={deleteProjectAction}
                fields={{ projectId: project.id }}
                label="Yes, delete it"
                pendingLabel="Deleting…"
                tone="danger"
              />
              <button
                onClick={() => setConfirmingDelete(false)}
                className="text-ink-muted hover:text-ink text-sm font-semibold"
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-tile border-cardinal-600 text-cardinal-600 hover:bg-cardinal-50 border px-3 py-1.5 text-sm font-semibold"
              >
                Delete project
              </button>
              <span className="text-ink-muted text-xs">
                Refused if it has sub-projects or signed-off work — mark it
                complete instead.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
