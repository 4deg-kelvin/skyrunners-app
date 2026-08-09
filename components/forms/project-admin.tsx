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
          placeholder="One sentence someone browsing Find Work would understand."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Responsible Engineer
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

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Target date{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="date"
            name="targetDate"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
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
            Make them a Responsible Engineer
            <span className="text-ink-muted block text-xs">
              RE authority inherits down — they&apos;ll be able to manage this
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
    return <span className="text-ink-muted text-xs">Primary RE</span>;
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
