"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  createCatalogueItemAction,
  createTrainingSectionAction,
  rejectCertificationAction,
  requestCertificationAction,
  revokeCertificationAction,
  setCatalogueItemActiveAction,
  updateCatalogueItemAction,
  verifyCertificationAction,
} from "@/lib/actions";
import type { CatalogueItem } from "@/lib/types";

/**
 * "I've done this training."
 *
 * The date matters — some clearances expire from the date you completed the
 * training, not the date somebody got round to verifying it, so the member
 * supplies it and the verifier confirms it rather than the clock starting at
 * sign-off.
 */
export function RequestTrainingForm({
  item,
  today,
}: {
  item: CatalogueItem;
  today: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        {item.kind === "site_access" ? "I have access" : "I'm trained"}
      </button>
    );
  }

  return (
    <ActionForm
      action={requestCertificationAction}
      submitLabel="Send to my Lead"
      submittingLabel="Sending…"
      onSuccess={() => setOpen(false)}
      className="mt-2 w-full rounded-tile border border-line bg-surface p-3"
    >
      <input type="hidden" name="itemId" value={item.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            {item.kind === "site_access" ? "Access granted on" : "Trained on"}
          </span>
          <input
            type="date"
            name="completedAt"
            required
            defaultValue={today}
            max={today}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Certificate link{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="url"
            name="certificateUrl"
            placeholder="https://…"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      <p className="mb-2.5 mt-2 text-xs text-ink-muted">
        Your Lead confirms it — nobody verifies their own training.
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

/** A Lead confirms or turns down a request. */
export function VerifyControls({
  certificationId,
  memberId,
  memberName,
}: {
  certificationId: string;
  memberId: string;
  memberName: string;
}) {
  const [rejecting, setRejecting] = useState(false);

  if (rejecting) {
    return (
      <ActionForm
        action={rejectCertificationAction}
        submitLabel="Send back"
        submittingLabel="Sending…"
        onSuccess={() => setRejecting(false)}
        className="mt-2 w-full rounded-tile border border-line bg-surface p-3"
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        <input type="hidden" name="memberId" value={memberId} />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            What does {memberName} still need to do?
          </span>
          <input
            type="text"
            name="note"
            placeholder="Do the Lab 64 orientation first, then re-submit."
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
        <p className="mb-2.5 mt-1 text-xs text-ink-muted">
          They see this. A bare no on a safety record leaves somebody guessing
          what to fix.
        </p>
        <button
          type="button"
          onClick={() => setRejecting(false)}
          className="ml-3 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
      </ActionForm>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        action={verifyCertificationAction}
        fields={{ certificationId, memberId }}
        label="Verify"
        pendingLabel="Verifying…"
        tone="primary"
      />
      <button
        onClick={() => setRejecting(true)}
        className="text-sm font-semibold text-ink-muted hover:text-ink"
      >
        Not yet
      </button>
    </div>
  );
}

/** Withdraw a clearance somebody shouldn't hold any more. */
export function RevokeButton({
  certificationId,
  memberId,
  itemName,
}: {
  certificationId: string;
  memberId: string;
  itemName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-semibold text-ink-muted hover:text-risk-fg"
      >
        Withdraw
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-soft">Withdraw {itemName}?</span>
      <ActionButton
        action={revokeCertificationAction}
        fields={{ certificationId, memberId }}
        label="Yes, withdraw"
        pendingLabel="Withdrawing…"
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

/**
 * Add a machine or an access. Co-Leads only.
 *
 * This form IS the feature. The requirement was that adding a training is a
 * Co-Lead typing a name, not a developer shipping a deploy — so it's a short
 * inline form on the page people already look at, not an admin console.
 */
export function AddCatalogueItemForm({
  sections,
}: {
  sections: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-tile border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <Plus className="size-4" />
        Add training
      </button>
    );
  }

  return (
    <ActionForm
      action={createCatalogueItemAction}
      submitLabel="Add"
      submittingLabel="Adding…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Name</span>
          <input
            type="text"
            name="name"
            required
            placeholder="Waterjet"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Site</span>
          <select
            name="sectionId"
            required
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Kind</span>
          <select
            name="kind"
            defaultValue="machine"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="machine">Machine training</option>
            <option value="site_access">Site access (a door)</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Expires after{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="number"
            name="validityMonths"
            min="1"
            placeholder="months — blank for never"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
          />
        </label>
      </div>

      <p className="mb-2.5 mt-3 text-xs text-ink-muted">
        Appears on everyone&apos;s list immediately, unearned. Site access is a
        door; a machine training is clearance on one machine inside it, and
        neither implies the other. Set an expiry only if the clearance really
        lapses — when it does, it&apos;s cancelled and the member&apos;s Lead is
        told.
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

export function AddSectionForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        Add a site
      </button>
    );
  }

  return (
    <ActionForm
      action={createTrainingSectionAction}
      submitLabel="Add site"
      submittingLabel="Adding…"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="mt-3 w-full rounded-tile border border-line bg-surface p-3.5"
    >
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Site name
        </span>
        <input
          type="text"
          name="name"
          required
          placeholder="Product Realization Lab"
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
        />
      </label>
      <p className="mb-2.5 mt-1 text-xs text-ink-muted">
        A building or lab the club works in. Machines go inside one.
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

/** Rename an entry, change its expiry, or retire it. */
export function EditCatalogueItemForm({ item }: { item: CatalogueItem }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-tile border border-line bg-surface p-3">
      <ActionForm
        action={updateCatalogueItemAction}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="itemId" value={item.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Name
            </span>
            <input
              type="text"
              name="name"
              required
              defaultValue={item.name}
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Expires after (months)
            </span>
            <input
              type="number"
              name="validityMonths"
              min="1"
              defaultValue={item.validityMonths ?? ""}
              placeholder="blank for never"
              className="w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            />
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

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <ActionButton
          action={setCatalogueItemActiveAction}
          fields={{ itemId: item.id, isActive: item.isActive ? "no" : "yes" }}
          label={item.isActive ? "Retire" : "Bring back"}
          pendingLabel="Saving…"
          tone={item.isActive ? "danger" : "primary"}
        />
        <span className="text-xs text-ink-muted">
          Retiring hides it from the list. People already cleared keep the
          record — deleting it would erase who was trained on what.
        </span>
      </div>
    </div>
  );
}
