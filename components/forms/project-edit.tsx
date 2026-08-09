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
 * means an RE of this project OR of anything above it in the project tree — RE
 * authority inherits downward. An RE of a sibling project cannot.
 */
export function ProjectEditForm({
  project,
  canDelete,
  incompleteDescendants,
}: {
  project: Project;
  canDelete: boolean;
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
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <Pencil className="size-3.5" strokeWidth={2.5} />
        Edit project
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5">
      <ActionForm
        action={updateProjectAction}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="projectId" value={project.id} />

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Name</span>
          <input
            type="text"
            name="name"
            required
            defaultValue={project.name}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            What it is
          </span>
          <textarea
            name="description"
            rows={2}
            defaultValue={project.description ?? ""}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Stage
            </span>
            <select
              name="phase"
              value={phase}
              onChange={(e) => setPhase(e.target.value as Project["phase"])}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              {PHASE_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PHASE_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              How it&apos;s going
            </span>
            <select
              name="health"
              defaultValue={project.health}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              {HEALTHS.map((h) => (
                <option key={h} value={h}>
                  {HEALTH_LABELS[h]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Target date
            </span>
            <input
              type="date"
              name="targetDate"
              defaultValue={project.targetDate ?? ""}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Help wanted
            </span>
            <input
              type="text"
              name="openRoles"
              defaultValue={project.openRoles ?? ""}
              placeholder="CFD, composites layup"
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>

        {/*
          Said before the submit, not after it.
          The operation refuses this anyway — that's the real guard, since a
          Server Action is a POST endpoint the moment it exists. This is so the
          RE knows WHY and which sub-projects to chase, instead of pressing save
          and being told no.
        */}
        {blockedFromCompleting ? (
          <div className="mb-2.5 mt-3 rounded-tile border border-warn-fg/25 bg-warn-bg p-3">
            <p className="flex items-start gap-2 text-sm text-warn-fg">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-semibold">
                  {incompleteDescendants.length} sub-project
                  {incompleteDescendants.length === 1 ? " isn't" : "s aren't"}{" "}
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
          <p className="mb-2.5 mt-3 text-xs text-ink-muted">
            Completing this posts a note in its updates feed and tells everyone
            above it — the REs of any parent projects, then the team leads, and
            finally the Division Lead. It stops there; Co-Leads aren&apos;t
            pinged for every finished project.
          </p>
        ) : null}

        <p className="mb-2.5 mt-3 text-xs text-ink-muted">
          Stage is where this sits in the lifecycle. How it&apos;s going is
          separate — a project can be at flight test and still blocked. Help
          wanted is matched against people&apos;s skills on Find Work.
        </p>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-5 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </ActionForm>

      {canDelete ? (
        <div className="mt-3 border-t border-line pt-3">
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
                className="text-sm font-semibold text-ink-muted hover:text-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-tile border border-cardinal-600 px-3 py-1.5 text-sm font-semibold text-cardinal-600 hover:bg-cardinal-50"
              >
                Delete project
              </button>
              <span className="text-xs text-ink-muted">
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
