"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createTermAction,
  deleteTermAction,
  updateTermAction,
} from "@/lib/actions";
import {
  TERM_KIND_HINTS,
  TERM_KIND_LABELS,
  TERM_KIND_ORDER,
} from "@/lib/labels";
import type { Term, TermKind } from "@/lib/types";

/**
 * The academic calendar, editable. Co-Leads only.
 *
 * The settings page has always shown which term you're in and said "a Co-Lead
 * needs to add the academic calendar before check-ins start generating" —
 * pointing at a screen that didn't exist. This is that screen.
 *
 * It matters more than it looks. `terms` is what stops every finals week and
 * winter break generating weeks of `missed` check-ins for the whole club: by
 * autumn the contribution record would be noise, and nudges would be landing
 * on students mid-finals. An empty calendar is not a neutral state.
 */

/** Shared by the create and edit forms — same fields, different action. */
function TermFields({ term, idPrefix }: { term?: Term; idPrefix: string }) {
  // Tracked so the hint under the picker reflects what's selected. The hint is
  // the part that prevents the mistake this whole table exists to prevent: a
  // finals week that still generates check-ins.
  const [kind, setKind] = useState<TermKind>(term?.kind ?? "quarter");
  const [override, setOverride] = useState(
    term ? term.generatesObligations !== (term.kind === "quarter") : false
  );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Name
          </span>
          <input
            type="text"
            name="name"
            required
            defaultValue={term?.name}
            placeholder="Autumn 2026"
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
            onChange={(e) => setKind(e.target.value as TermKind)}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {TERM_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {TERM_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Starts
          </span>
          <input
            type="date"
            name="startsOn"
            required
            defaultValue={term?.startsOn}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Ends
          </span>
          <input
            type="date"
            name="endsOn"
            required
            defaultValue={term?.endsOn}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-ink-muted mt-2 text-xs">{TERM_KIND_HINTS[kind]}</p>

      {/*
        The override is deliberately behind a checkbox rather than being a plain
        third dropdown. "Does this generate check-ins" follows from the kind
        99% of the time, and a field you have to set every time is a field that
        eventually gets set wrong on a finals week.
      */}
      <label className="text-ink-soft mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
          className="mt-0.5"
          id={`${idPrefix}-override`}
        />
        <span>
          Override: check-ins {kind === "quarter" ? "do NOT" : "DO"} run during
          this period.
        </span>
      </label>

      {override ? (
        <input
          type="hidden"
          name="generatesObligations"
          value={kind === "quarter" ? "no" : "yes"}
        />
      ) : null}
    </>
  );
}

export function AddTermForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
      >
        <Plus className="size-4" />
        Add period
      </button>
    );
  }

  return (
    <ActionForm
      action={createTermAction}
      submitLabel="Add"
      submittingLabel="Adding…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5"
    >
      <TermFields idPrefix="new-term" />
      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        Add each quarter, finals week and break. Periods can&apos;t overlap —
        two covering the same day would make &ldquo;are check-ins due
        today?&rdquo; depend on which was entered first.
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

export function EditTermForm({ term }: { term: Term }) {
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

  return (
    <div className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5">
      <ActionForm
        action={updateTermAction}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="termId" value={term.id} />
        <TermFields term={term} idPrefix={`term-${term.id}`} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink mt-3 ml-5 text-sm font-semibold"
        >
          Cancel
        </button>
      </ActionForm>

      <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
        <ActionButton
          action={deleteTermAction}
          fields={{ termId: term.id }}
          label="Remove"
          pendingLabel="Removing…"
          tone="danger"
        />
        <span className="text-ink-muted text-xs">
          Refused for the period covering today — that would move
          everyone&apos;s obligations with no warning.
        </span>
      </div>
    </div>
  );
}
