"use client";

import { useState } from "react";
import { Pencil, TriangleAlert } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { deleteProjectAction, updateProjectAction } from "@/lib/actions";
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
}: {
  project: Project;
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

          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Target date
            </span>
            <input
              type="date"
              name="targetDate"
              defaultValue={project.targetDate ?? ""}
              max={parentTargetDate}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
            {parentTargetDate ? (
              <span className="text-ink-muted mt-1 block text-xs">
                Can&apos;t be after {parentTargetDate} — the project above is
                due then.
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

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
        >
          Cancel
        </button>
      </ActionForm>

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
