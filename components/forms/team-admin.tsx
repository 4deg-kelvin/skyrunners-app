"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionForm } from "./action-form";
import { createTeamAction, setProjectTeamAction } from "@/lib/actions";

export interface TeamOption {
  id: string;
  name: string;
}

/**
 * Point a project at the division that owns it.
 *
 * `/find-work` and `/projects` both group by division, and they resolve it by
 * walking up from the project's team. A project with no team resolves to no
 * division and quietly appears on neither page — which is the opposite of what
 * an app built around discoverability should do. The dashboard warns about it;
 * this is how you fix it.
 */
export function ProjectTeamForm({
  projectId,
  currentTeamId,
  teams,
}: {
  projectId: string;
  currentTeamId?: string;
  teams: TeamOption[];
}) {
  return (
    <ActionForm
      action={setProjectTeamAction}
      submitLabel="Set owning team"
      submittingLabel="Saving…"
      className="mt-3"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Owning team
        </span>
        <select
          name="teamId"
          defaultValue={currentTeamId ?? ""}
          className="mb-2 w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
        >
          <option value="">Not assigned</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <p className="mb-2 text-xs text-ink-muted">
        Which division this sits under. Members browse by division, so a project
        without one is hard to find.
      </p>
    </ActionForm>
  );
}

/**
 * Create a division, or a sub-team inside one.
 *
 * Co-Leads only — this is the shape of the org, and everything else hangs off
 * it. A division is simply a team with nothing above it.
 */
export function CreateTeamForm({ divisions }: { divisions: TeamOption[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <Plus className="size-4" />
        New division
      </button>
    );
  }

  return (
    <ActionForm
      action={createTeamAction}
      submitLabel="Create"
      submittingLabel="Creating…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Name
          </span>
          <input
            type="text"
            name="name"
            required
            placeholder="Avionics"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Sits under
          </span>
          <select
            name="parentId"
            defaultValue=""
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="">Nothing — this is a division</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mb-3 mt-3 text-xs text-ink-muted">
        Divisions are the top level — Airframe, Avionics, and so on. Leave the
        second box alone to make one; pick a division to nest a sub-team inside
        it.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
