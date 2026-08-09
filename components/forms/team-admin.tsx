"use client";

import { useState } from "react";
import { Archive, Plus, RotateCcw } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  archiveTeamAction,
  createTeamAction,
  deleteTeamAction,
  restoreTeamAction,
  setProjectTeamAction,
  updateTeamAction,
} from "@/lib/actions";

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
  currentDivisionName,
  teams,
}: {
  projectId: string;
  currentTeamId?: string;
  currentDivisionName?: string;
  teams: TeamOption[];
}) {
  // Collapsed once it's set. Which division a project belongs to is answered
  // once and then almost never revisited, so it earns one line — not a card
  // above the deliverables and the team, which are what people came for.
  const [open, setOpen] = useState(!currentDivisionName);

  if (!open) {
    return (
      <p className="text-sm text-ink-muted">
        Division:{" "}
        <span className="font-semibold text-ink">{currentDivisionName}</span>{" "}
        <button
          onClick={() => setOpen(true)}
          className="font-semibold text-cardinal-600 hover:text-cardinal-700"
        >
          Change
        </button>
      </p>
    );
  }

  return (
    <div className="rounded-tile border border-line bg-surface p-3">
      {!currentDivisionName ? (
        <p className="mb-2 text-sm text-warn-fg">
          No division set, so this project doesn&apos;t appear on Projects or
          Find Work.
        </p>
      ) : null}

      <ActionForm
        action={setProjectTeamAction}
        submitLabel="Set division"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="projectId" value={projectId} />
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
        <p className="mb-2 text-xs text-ink-muted">
          Members browse by division, so a project without one is hard to find.
        </p>
      </ActionForm>
    </div>
  );
}

/**
 * Create a division, or a sub-team inside one.
 *
 * Co-Leads only — this is the shape of the org, and everything else hangs off
 * it. A division is simply a team with nothing above it.
 */
export function CreateTeamForm({
  divisions,
  people,
}: {
  divisions: TeamOption[];
  people: { id: string; name: string }[];
}) {
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

        {/*
          The Division Lead is shown on /projects and could never be set:
          `createTeam` and `updateTeam` both accepted a `leadId` and neither
          form had the field, so every division was created without one and the
          name never appeared.
        */}
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Division Lead
          </span>
          <select
            name="leadId"
            defaultValue=""
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
        className="ml-5 text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/**
 * Rename a division, move it, retire it. Co-Leads only.
 *
 * Two ways to make one go away, and which you get depends on whether it has a
 * past:
 *
 *   - **Archive** keeps everything and hides the division. This is the normal
 *     one. Refused while any project under it is still running.
 *   - **Delete** is refused while ANY project or sub-team points at it, which
 *     narrows it to a division created by mistake — nothing to preserve.
 *
 * Archive is the primary button because the club reorganises yearly and the
 * projects a division built are the record of what got made.
 */
export function EditTeamForm({
  team,
  divisions,
  people,
}: {
  team: {
    id: string;
    name: string;
    parentId: string | null;
    leadId?: string;
  };
  divisions: TeamOption[];
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5">
      <ActionForm
        action={updateTeamAction}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="teamId" value={team.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Name
            </span>
            <input
              type="text"
              name="name"
              required
              defaultValue={team.name}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Sits under
            </span>
            <select
              name="parentId"
              defaultValue={team.parentId ?? ""}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Nothing — this is a division</option>
              {divisions
                .filter((d) => d.id !== team.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>

          {/*
            This field's absence was a silent data-loss bug, not a missing
            feature. `updateTeam` assigned `team.leadId = input.leadId` and the
            form posted nothing, so renaming a division cleared its lead — the
            name on /projects just stopped being there.
          */}
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Division Lead
            </span>
            <select
              name="leadId"
              defaultValue={team.leadId ?? ""}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Nobody</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-5 mt-3 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </ActionForm>

      <div className="mt-3 border-t border-line pt-3">
        {archiving ? (
          <ActionForm
            action={archiveTeamAction}
            submitLabel="Archive it"
            submittingLabel="Archiving…"
            onSuccess={() => {
              setArchiving(false);
              setOpen(false);
            }}
          >
            <input type="hidden" name="teamId" value={team.id} />
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-ink">
                Why is {team.name} being retired?
              </span>
              <input
                type="text"
                name="note"
                placeholder="Merged into Airframe for 2026–27."
                className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
              />
            </label>
            <p className="mb-2.5 mt-1 text-xs text-ink-muted">
              Optional, and shown on the archive page. Somebody reading this in
              two years is the person it&apos;s for. Its projects, sub-teams and
              completed work all come with it — nothing is deleted. Refused if
              any project here is still running.
            </p>
            <button
              type="button"
              onClick={() => setArchiving(false)}
              className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </ActionForm>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setArchiving(true)}
              className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
            >
              <Archive className="size-3.5" strokeWidth={2.5} />
              Archive division
            </button>
            <ActionButton
              action={deleteTeamAction}
              fields={{ teamId: team.id }}
              label="Delete"
              pendingLabel="Deleting…"
              tone="danger"
            />
            <span className="text-xs text-ink-muted">
              Archive keeps the history. Delete only works on a division nothing
              points at.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Bring a division back out of the archive. Co-Leads only. */
export function RestoreTeamButton({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <RotateCcw className="size-3.5" strokeWidth={2.5} />
        Restore
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">Bring {teamName} back?</span>
      <ActionButton
        action={restoreTeamAction}
        fields={{ teamId }}
        label="Yes, restore"
        pendingLabel="Restoring…"
        tone="primary"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
