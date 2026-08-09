"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createEventAction,
  deleteEventAction,
  setEventAttendanceAction,
  updateEventAction,
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
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
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
      className="rounded-tile border-line bg-surface w-full border p-3.5 text-left"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What
          </span>
          <input
            type="text"
            name="title"
            required
            placeholder="Spar layup — come help"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Kind
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Project{" "}
            <span className="text-ink-muted font-normal">
              {canCreateClubEvent || kind === "one_on_one"
                ? "(optional)"
                : "(required)"}
            </span>
          </span>
          <select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
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
          <span className="text-ink mb-1 block text-sm font-semibold">
            Starts
          </span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={`${today}T18:00`}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Ends <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="datetime-local"
            name="endsAt"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Where <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="location"
            placeholder="Lab 64"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
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
            <span className="text-ink mb-1 block text-sm font-semibold">
              Importance
            </span>
            <select
              name="importanceWeight"
              defaultValue=""
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
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
          <span className="text-ink mb-1 block text-sm font-semibold">
            Who&apos;s working on it{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <select
            name="attendeeIds"
            multiple
            size={4}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
          <span className="text-ink-muted mt-1 block text-xs">
            You&apos;re added automatically. Naming people isn&apos;t an
            invitation to accept — it just says who&apos;s on it.
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Anything else{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="notes"
            placeholder="Third pair of hands welcome — no experience needed."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        {kind === "one_on_one"
          ? "A 1:1 shows as a busy block so people can see the time is taken. No agenda, and nobody else can drop in."
          : "Everyone can see it and anyone can turn up. That's the point — somebody who isn't on the project may still be the person who can help."}
        {needsProject
          ? " Pick a project first — a session belongs to work you're on."
          : ""}
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
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

/**
 * Move or rename something already on the calendar.
 *
 * This exists rather than "cancel it and add it again" because cancelling
 * DELETES the attendee list. The commonest edit by far is a time slipping by an
 * hour, and making that cost everyone their "I'll be there" is how a calendar
 * stops being believed — the row would show nobody coming to a session six
 * people had already committed to.
 *
 * Attendance is deliberately not editable here for the same reason it isn't on
 * the create form: turning up is the attendee's call, not the organiser's.
 * `updateEvent` never touches the list.
 */
export function EditEventForm({
  event,
  canSetImportance,
}: {
  event: {
    id: string;
    title: string;
    kind: EventKind;
    startsAt: string;
    endsAt?: string;
    location?: string;
    notes?: string;
    importanceWeight: number;
  };
  /** Leadership. Gates the wider kind list and the importance dial. */
  canSetImportance: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
      >
        Edit
      </button>
    );
  }

  // Copied, not aliased. `unshift` on the module-level array would leak the
  // extra option into every other form on the page and grow it on each render.
  const allowed = canSetImportance ? LEADERSHIP_KINDS : MEMBER_KINDS;
  // Whoever set it up may have picked a kind this viewer can't normally choose
  // — keep it in the list rather than silently rewriting their event on save.
  const kinds = allowed.includes(event.kind)
    ? allowed
    : [event.kind, ...allowed];

  return (
    <ActionForm
      action={updateEventAction}
      submitLabel="Save changes"
      submittingLabel="Saving…"
      onSuccess={() => setOpen(false)}
      className="rounded-tile border-line bg-surface mt-2 w-full border p-3.5 text-left"
    >
      <input type="hidden" name="eventId" value={event.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What
          </span>
          <input
            type="text"
            name="title"
            required
            defaultValue={event.title}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Kind
          </span>
          <select
            name="kind"
            defaultValue={event.kind}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Where <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="location"
            defaultValue={event.location ?? ""}
            placeholder="Lab 64"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        {/* Stored as local wall time with no zone, so it drops straight into a
            datetime-local field. Slicing guards against a stored seconds part. */}
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Starts
          </span>
          <input
            type="datetime-local"
            name="startsAt"
            required
            defaultValue={event.startsAt.slice(0, 16)}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Ends <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="datetime-local"
            name="endsAt"
            defaultValue={event.endsAt?.slice(0, 16) ?? ""}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        {canSetImportance ? (
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Importance
            </span>
            <select
              name="importanceWeight"
              defaultValue={String(event.importanceWeight)}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            >
              <option value="5">5 — everyone should be there</option>
              <option value="4">4 — important</option>
              <option value="3">3 — normal</option>
              <option value="2">2 — minor</option>
              <option value="1">1 — background</option>
            </select>
          </label>
        ) : null}

        <label className="block sm:col-span-2">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Anything else{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="notes"
            defaultValue={event.notes ?? ""}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        Whoever said they&apos;d be there stays on the list. Moving the time
        doesn&apos;t un-invite anyone — tell them if it&apos;s a big move.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
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
        className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
      >
        Cancel
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-ink-soft text-sm">Cancel {title}?</span>
      <ActionButton
        action={deleteEventAction}
        fields={{ eventId }}
        label="Yes, cancel it"
        pendingLabel="Cancelling…"
        tone="danger"
      />
      <button
        onClick={() => setConfirming(false)}
        className="text-ink-muted hover:text-ink text-sm font-semibold"
      >
        Keep it
      </button>
    </span>
  );
}
