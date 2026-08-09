"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createEventAction,
  deleteEventAction,
  setEventAttendanceAction,
} from "@/lib/actions";
import { EVENT_KIND_LABELS } from "@/lib/labels";
import type { EventKind } from "@/lib/types";

/**
 * Put something on the calendar.
 *
 * Three shapes behind one button, because they're the same form with different
 * defaults and pretending otherwise would mean three near-identical dialogs:
 *
 *   - **A session on a project you're on.** Any member. The case the calendar
 *     exists for — two people on the spar Thursday night, so a third can turn
 *     up.
 *   - **A club-wide event.** Leadership only, because it implicitly asks
 *     everyone to show up.
 *   - **A 1:1.** Anyone, with anyone. Two engineers sitting down to engineer,
 *     explicitly not a performance review — which is why there's no agenda
 *     field and it shows as a busy block.
 */

/** Sessions and 1:1s are what a plain member can create. */
const MEMBER_KINDS: EventKind[] = ["build_session", "one_on_one"];

const LEADERSHIP_KINDS: EventKind[] = [
  "general_meeting",
  "design_review",
  "build_session",
  "training",
  "company_tour",
  "company_visit",
  "competition",
  "social",
  "one_on_one",
];

export function CreateEventForm({
  myProjects,
  people,
  canCreateClubEvent,
  today,
}: {
  myProjects: { id: string; name: string }[];
  people: { id: string; fullName: string }[];
  canCreateClubEvent: boolean;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EventKind>("build_session");
  const [projectId, setProjectId] = useState("");

  const kinds = canCreateClubEvent ? LEADERSHIP_KINDS : MEMBER_KINDS;

  // A plain member needs a project to hang a session on — that's what makes it
  // theirs to schedule. A 1:1 needs nobody's permission.
  const needsProject =
    !canCreateClubEvent && kind !== "one_on_one" && !projectId;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
      >
        <CalendarPlus className="size-4" strokeWidth={2.5} />
        Add to calendar
      </button>
    );
  }

  return (
    <ActionForm
      action={createEventAction}
      submitLabel="Add it"
      submittingLabel="Adding…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      disabled={needsProject}
      className="w-full rounded-tile border border-line bg-surface p-3.5 text-left"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold text-ink">What</span>
          <input
            type="text"
            name="title"
            required
            placeholder="Spar layup — come help"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Kind</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Project{" "}
            <span className="font-normal text-ink-muted">
              {canCreateClubEvent || kind === "one_on_one"
                ? "(optional)"
                : "(required)"}
            </span>
          </span>
          <select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="">
              {canCreateClubEvent ? "Club-wide" : "Pick a project"}
            </option>
            {myProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Starts
          </span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={`${today}T18:00`}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Ends <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="datetime-local"
            name="endsAt"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Where <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="text"
            name="location"
            placeholder="Lab 64"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        {/*
          Importance is 1–5 and NOT a proxy for "is this official" — a company
          tour can be a 5 and a routine standup a 2. Leadership sets it; a
          member's session takes the default for its kind, which is why the
          field only appears for them.
        */}
        {canCreateClubEvent ? (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Importance
            </span>
            <select
              name="importanceWeight"
              defaultValue=""
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Default for this kind</option>
              <option value="5">5 — everyone should be there</option>
              <option value="4">4 — important</option>
              <option value="3">3 — normal</option>
              <option value="2">2 — minor</option>
              <option value="1">1 — background</option>
            </select>
          </label>
        ) : null}

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Who&apos;s working on it{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <select
            name="attendeeIds"
            multiple
            size={4}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            You&apos;re added automatically. Naming people isn&apos;t an
            invitation to accept — it just says who&apos;s on it.
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Anything else{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="text"
            name="notes"
            placeholder="Third pair of hands welcome — no experience needed."
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      <p className="mb-2.5 mt-3 text-xs text-ink-muted">
        {kind === "one_on_one"
          ? "A 1:1 shows as a busy block so people can see the time is taken. No agenda, and nobody else can drop in."
          : "Everyone can see it and anyone can turn up. That's the point — somebody who isn't on the project may still be the person who can help."}
        {needsProject ? " Pick a project first — a session belongs to work you're on." : ""}
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

/** Turn up, or step back out. Only for open events. */
export function AttendToggle({
  eventId,
  attending,
}: {
  eventId: string;
  attending: boolean;
}) {
  return (
    <ActionButton
      action={setEventAttendanceAction}
      fields={{ eventId, attending: attending ? "no" : "yes" }}
      label={attending ? "Not coming" : "I'll be there"}
      pendingLabel="Saving…"
      tone={attending ? "default" : "primary"}
    />
  );
}

export function CancelEventButton({
  eventId,
  title,
}: {
  eventId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-semibold text-ink-muted hover:text-risk-fg"
      >
        Cancel
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">Cancel {title}?</span>
      <ActionButton
        action={deleteEventAction}
        fields={{ eventId }}
        label="Yes, cancel it"
        pendingLabel="Cancelling…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Keep it
      </button>
    </span>
  );
}
