"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createEventAction,
  deleteEventAction,
  setEventAttendanceAction,
  setEventGuestListAction,
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

/**
 * Does it repeat, and until when.
 *
 * Shared by the create and edit forms so the two cannot drift — the edit form
 * having a different set of cadences from the create form is the kind of thing
 * nobody notices until somebody can't turn a weekly meeting into a fortnightly
 * one.
 *
 * ---------------------------------------------------------------------------
 * Why the END DATE is required once it repeats
 * ---------------------------------------------------------------------------
 *
 * An open-ended weekly meeting would expand forever, and a calendar feed has to
 * stop somewhere. Requiring it also matches how a club actually plans: the team
 * meeting runs to the end of the quarter, not to the end of time. Anish asked to
 * be able to "easily edit and change" the range, and a range with a real end is
 * the thing that can be edited — you extend it next quarter.
 *
 * The `min` is the event's own start date, so the picker cannot express a range
 * that ends before it begins. `repeatProblem` enforces the same rule on the
 * server, and its message names the mistake.
 */
function RepeatFields({
  defaultUntil,
  defaultEveryWeeks,
  startDate,
}: {
  defaultUntil?: string;
  defaultEveryWeeks?: number;
  /** `YYYY-MM-DD`, used as the earliest end date the picker offers. */
  startDate: string;
}) {
  const [repeats, setRepeats] = useState(Boolean(defaultUntil));

  return (
    /*
      `sm:col-span-2` and `min-w-0`, and both are load-bearing.

      Both call sites drop this into a `grid sm:grid-cols-2`, so without the span it
      became a HALF-WIDTH column containing its own two-column grid of a select and
      a date input. `<input type="date">` has a large intrinsic minimum width (the
      picker plus the placeholder), and a grid item defaults to `min-width: auto`,
      which means it refuses to shrink below its content — so the whole form
      overflowed off the right of the screen.

      Exactly the roster bug in docs/HANDOFF.md: cards 302px wide in a 286px
      column. `min-w-0` is the other half of that fix, letting the inner columns
      actually give way instead of pushing the container wider.
    */
    <div className="rounded-tile border-line bg-surface min-w-0 border px-3.5 py-3 sm:col-span-2">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={repeats}
          onChange={(e) => setRepeats(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          <span className="text-ink block text-sm font-semibold">
            It repeats
          </span>
          <span className="text-ink-muted block text-xs">
            For the team meeting or the townhall. One entry, not ten — and
            anyone who says they&apos;re coming gets every week in their own
            calendar.
          </span>
        </span>
      </label>

      {repeats ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* `min-w-0` on each column too, so a date input can never widen the
              row past its container. See the note on the wrapper above. */}
          <label className="block min-w-0">
            <span className="text-ink mb-1 block text-xs font-semibold">
              How often
            </span>
            <select
              name="repeatEveryWeeks"
              defaultValue={defaultEveryWeeks === 2 ? "2" : "1"}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            >
              <option value="1">Every week</option>
              <option value="2">Every other week</option>
            </select>
          </label>

          <label className="block min-w-0">
            <span className="text-ink mb-1 block text-xs font-semibold">
              Last one on
            </span>
            <input
              type="date"
              name="repeatUntil"
              required
              min={startDate}
              defaultValue={defaultUntil?.slice(0, 10)}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
            <span className="text-ink-muted mt-1 block text-xs">
              End of the quarter is the usual answer. You can extend it later.
            </span>
          </label>
        </div>
      ) : (
        /*
          An explicit empty value when the box is unchecked.

          Without it the field is simply absent from the FormData, which the EDIT
          action reads as "leave the repeat alone" — so unticking the box would
          silently fail to stop a meeting repeating. The create action treats empty
          and absent identically, so this is harmless there.
        */
        <input type="hidden" name="repeatUntil" value="" />
      )}
    </div>
  );
}

export function CreateEventForm({
  myProjects,
  people,
  canCreateClubEvent,
  canCloseEvent = false,
  today,
}: {
  myProjects: { id: string; name: string }[];
  people: { id: string; fullName: string }[];
  canCreateClubEvent: boolean;
  /**
   * May create an event nobody can join. Co-Lead only.
   *
   * Narrower than `canCreateClubEvent` deliberately: an open calendar is the
   * point of this feature, and every closed event is a small subtraction from
   * it. See `can.createClosedEvent`.
   */
  canCloseEvent?: boolean;
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

        <RepeatFields startDate={today} />

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

        {/*
          Invite-only. Co-Leads only, and off by default.

          A 1:1 is already closed by its kind, so the box would be a no-op
          there and is hidden rather than shown ticked and inert.
        */}
        {canCloseEvent && kind !== "one_on_one" ? (
          <label className="rounded-tile border-line bg-card flex items-start gap-2.5 border px-3 py-2.5 sm:col-span-2">
            <input
              type="checkbox"
              name="inviteOnly"
              value="yes"
              className="accent-cardinal-600 mt-0.5 size-4"
            />
            <span>
              <span className="text-ink block text-sm font-semibold">
                Invite only
              </span>
              <span className="text-ink-muted block text-xs">
                Nobody can add themselves — you set the list, and only you can
                change it. It still shows on everyone&apos;s calendar so the
                time reads as taken.
              </span>
            </span>
          </label>
        ) : null}
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
  repeats = false,
}: {
  eventId: string;
  attending: boolean;
  /** True for a series, so the note can say every week is covered. */
  repeats?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <ActionButton
        action={setEventAttendanceAction}
        fields={{ eventId, attending: attending ? "no" : "yes" }}
        label={attending ? "Not coming" : "I'll be there"}
        pendingLabel="Saving…"
        tone={attending ? "default" : "primary"}
      />

      {/*
        Say what happens next, and how long it takes.

        Anish asked for exactly this: no notification on RSVP, just a small note
        that the calendar will catch up. It matters because the delay is real and
        invisible — a subscription is a pull, so nothing appears the moment you
        press this, and a member who checks their phone straight away and sees
        nothing concludes the feature is broken.

        Only shown once they're actually coming. Before that it would be a promise
        about something they haven't done.
      */}
      {attending ? (
        <span className="text-ink-muted text-xs">
          {repeats
            ? "Every week is in your calendar — it can take a few hours to show up."
            : "It'll appear in your calendar within a few hours."}
        </span>
      ) : null}
    </div>
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
  canCloseEvent = false,
  projects = [],
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
    projectId?: string;
    isOpen: boolean;
    /** Set when it repeats, so the range comes back pre-filled and editable. */
    repeatUntil?: string;
    repeatEveryWeeks?: number;
  };
  /** Leadership. Gates the wider kind list and the importance dial. */
  canSetImportance: boolean;
  /** Co-Lead. May open or close the event - see `can.createClosedEvent`. */
  canCloseEvent?: boolean;
  /**
   * Every project, not just the organiser's.
   *
   * Editing is already gated on being the organiser or leadership, and the
   * commonest reason to touch this field is attaching a session somebody
   * created club-wide to the work it turned out to be about.
   */
  projects?: { id: string; name: string }[];
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

        {/*
          The link to the work.

          Always rendered, so an empty value is a deliberate unlink - the
          action distinguishes "field absent" from "field cleared" for exactly
          this reason. Attaching a session to its project is what makes it show
          up on that project's page and its timeline.
        */}
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Project{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <select
            name="projectId"
            defaultValue={event.projectId ?? ""}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            <option value="">Not about a specific project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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

        <RepeatFields
          startDate={event.startsAt.slice(0, 10)}
          defaultUntil={event.repeatUntil}
          defaultEveryWeeks={event.repeatEveryWeeks}
        />

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

        {canCloseEvent && event.kind !== "one_on_one" ? (
          <label className="rounded-tile border-line bg-card flex items-start gap-2.5 border px-3 py-2.5 sm:col-span-2">
            <input
              type="checkbox"
              name="inviteOnly"
              value="yes"
              defaultChecked={!event.isOpen}
              className="accent-cardinal-600 mt-0.5 size-4"
            />
            <span>
              <span className="text-ink block text-sm font-semibold">
                Invite only
              </span>
              <span className="text-ink-muted block text-xs">
                Closing it doesn&apos;t remove anyone who already said
                they&apos;d come - take them off the list explicitly if you mean
                to.
              </span>
            </span>
          </label>
        ) : null}
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

/**
 * Who is on a closed event. The organiser's list, not the attendee's choice.
 *
 * The counterpart to `AttendToggle`, and the reason `isOpen: false` is usable
 * at all: `setEventAttendance` refuses a closed event by design, so before
 * this there was no way to change an invite-only guest list after creation -
 * the organiser had to cancel and recreate, losing the event.
 *
 * A multi-select rather than an add/remove list because the whole point of a
 * closed event is that the list is a SET somebody decided, not a queue that
 * accumulated. You edit it as one thing and save it as one thing.
 */
export function GuestListForm({
  eventId,
  attendeeIds,
  people,
}: {
  eventId: string;
  attendeeIds: string[];
  people: { id: string; fullName: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
      >
        Who&apos;s coming
      </button>
    );
  }

  return (
    <ActionForm
      action={setEventGuestListAction}
      submitLabel="Save the list"
      submittingLabel="Saving..."
      onSuccess={() => setOpen(false)}
      className="rounded-tile border-line bg-surface mt-2 w-full border p-3.5 text-left"
    >
      <input type="hidden" name="eventId" value={eventId} />

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          On this event
        </span>
        <select
          name="attendeeIds"
          multiple
          size={8}
          defaultValue={attendeeIds}
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </label>

      <p className="text-ink-muted mt-2 mb-2.5 text-xs">
        Hold Cmd or Ctrl to pick several. You stay on it either way - an event
        whose organiser isn&apos;t listed reads as somebody else&apos;s.
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
