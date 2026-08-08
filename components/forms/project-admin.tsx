"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import { addProjectMemberAction, createProjectAction, setProjectREAction } from "@/lib/actions";

export interface Option {
  id: string;
  name: string;
}

/**
 * Create a project.
 *
 * Permissions here are deliberately permissive (see `can.createProject`): any
 * Lead can start a top-level project, and an RE can start one inside their own
 * subtree. Making project creation feel heavyweight is how a club ends up
 * tracking real work in a side document instead.
 *
 * The RE defaults to the creator, because a project with no accountable person
 * is the one state the model cannot represent.
 */
export function CreateProjectForm({
  parents,
  divisions,
  people,
  defaultReId,
  parentId,
  label = "New project",
}: {
  parents: Option[];
  divisions: Option[];
  people: Option[];
  defaultReId: string;
  /** Fixed parent — used for "add a sub-project" on a project page. */
  parentId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
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
      className="w-full rounded-card border border-line bg-card p-4 text-left"
    >
      {parentId ? <input type="hidden" name="parentId" value={parentId} /> : null}

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">Name</span>
        <input
          type="text"
          name="name"
          required
          placeholder="Tail Boom Redesign"
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>

      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          What is it? <span className="font-normal text-ink-muted">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={2}
          placeholder="One sentence someone browsing Find Work would understand."
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Responsible Engineer
          </span>
          <select
            name="primaryReId"
            defaultValue={defaultReId}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Accountable for the deliverables. Can be changed later.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Target date{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="date"
            name="targetDate"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </div>

      {!parentId ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Division
            </span>
            <select
              name="teamId"
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
            >
              <option value="">— pick one —</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-muted">
              Without one it won&apos;t show up grouped on Projects.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Sits under{" "}
              <span className="font-normal text-ink-muted">(optional)</span>
            </span>
            <select
              name="parentId"
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
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
        className="ml-3 mt-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/** Add someone to a project, optionally as an RE. */
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
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
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
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Who</span>
          <select
            name="memberId"
            required
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            What they own{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="text"
            name="responsibility"
            placeholder="Structural analysis"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      {canAssignRE ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="asRE" value="yes" className="mt-1" />
          <span>
            Make them a Responsible Engineer
            <span className="block text-xs text-ink-muted">
              RE authority inherits down — they&apos;ll be able to manage this
              project and everything under it.
            </span>
          </span>
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 mt-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/** Promote to RE, demote, or hand over the primary role. */
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
    return <span className="text-xs text-ink-muted">Primary RE</span>;
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
            label="Remove RE"
            pendingLabel="Saving…"
            tone="danger"
          />
        </>
      ) : (
        <ActionButton
          action={setProjectREAction}
          fields={{ projectId, memberId, mode: "add" }}
          label="Make RE"
          pendingLabel="Saving…"
        />
      )}
    </div>
  );
}
