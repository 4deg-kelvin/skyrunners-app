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
  setCatalogueVerifierAction,
  verifyCertificationAction,
} from "@/lib/actions";
import type { CatalogueItem, CatalogueVerifier } from "@/lib/types";

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
        className="rounded-tile border-line text-ink hover:bg-surface border px-3 py-1.5 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface mt-2 w-full border p-3"
    >
      <input type="hidden" name="itemId" value={item.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            {item.kind === "site_access" ? "Access granted on" : "Trained on"}
          </span>
          <input
            type="date"
            name="completedAt"
            required
            defaultValue={today}
            max={today}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Certificate link{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="url"
            name="certificateUrl"
            placeholder="https://…"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-ink-muted mt-2 mb-2.5 text-xs">
        Whoever verifies this one confirms it — and it&apos;s never you, unless
        it&apos;s marked self-verify.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mr-3 text-sm font-semibold"
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
        className="rounded-tile border-line bg-surface mt-2 w-full border p-3"
      >
        <input type="hidden" name="certificationId" value={certificationId} />
        <input type="hidden" name="memberId" value={memberId} />
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            What does {memberName} still need to do?
          </span>
          <input
            type="text"
            name="note"
            placeholder="Do the Lab 64 orientation first, then re-submit."
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
        <p className="text-ink-muted mt-1 mb-2.5 text-xs">
          They see this. A bare no on a safety record leaves somebody guessing
          what to fix.
        </p>
        <button
          type="button"
          onClick={() => setRejecting(false)}
          className="text-ink-muted hover:text-ink mr-3 text-sm font-semibold"
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
        className="text-ink-muted hover:text-ink text-sm font-semibold"
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
        className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
      >
        Withdraw
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-ink-soft text-sm">Withdraw {itemName}?</span>
      <ActionButton
        action={revokeCertificationAction}
        fields={{ certificationId, memberId }}
        label="Yes, withdraw"
        pendingLabel="Withdrawing…"
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
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Name
          </span>
          <input
            type="text"
            name="name"
            required
            placeholder="Waterjet"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Site
          </span>
          <select
            name="sectionId"
            required
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Kind
          </span>
          <select
            name="kind"
            defaultValue="machine"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          >
            <option value="machine">Machine training</option>
            <option value="site_access">Site access (a door)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Expires after{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="number"
            name="validityMonths"
            min="1"
            placeholder="months — blank for never"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        Appears on everyone&apos;s list immediately, unearned. Site access is a
        door; a machine training is clearance on one machine inside it, and
        neither implies the other. Set an expiry only if the clearance really
        lapses — when it does, it&apos;s cancelled and shows up as expired for
        whoever verifies it.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mr-3 text-sm font-semibold"
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
        className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
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
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5"
    >
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Site name
        </span>
        <input
          type="text"
          name="name"
          required
          placeholder="Product Realization Lab"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
        />
      </label>
      <p className="text-ink-muted mt-1 mb-2.5 text-xs">
        A building or lab the club works in. Machines go inside one.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink mr-3 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}

/**
 * Rename an entry, change its expiry, or retire it.
 *
 * **Club-wide, and therefore NOT rendered on anybody's profile.** Retiring the
 * Trotec means it leaves the shop for everyone — that has no business sitting
 * on a row inside one person's training list, next to controls that only
 * affect that person. It lives in Settings with the academic calendar, which
 * is the other "a Co-Lead configures the club" surface.
 *
 * The two scopes were mixed up in the first version and it read exactly as
 * wrong as it was: a Lead verifying somebody's laser training could, from the
 * same row, delete the laser.
 */
/**
 * Edit one catalogue item: its name, its expiry, and WHO VERIFIES IT.
 *
 * The verifier is a separate form inside the same panel rather than three more
 * fields on the first one, and that is deliberate. Renaming the mill and
 * deciding who signs the mill off are different acts with different stakes: one
 * is a typo fix, the other decides whether anybody can be cleared for a machine.
 * Saving them together means a Co-Lead correcting a spelling has to re-confirm
 * a safety assignment, which is how people learn to click Save without reading.
 */
export function EditCatalogueItemForm({
  item,
  verifier,
  verifierOptions,
}: {
  item: CatalogueItem;
  /** Current config. Undefined means unconfigured — any Lead can verify. */
  verifier?: CatalogueVerifier;
  /** Active leadership, already sorted by the data layer. */
  verifierOptions: { id: string; fullName: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [selfVerify, setSelfVerify] = useState(!!verifier?.selfVerify);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-cardinal-600 hover:text-cardinal-700 text-xs font-semibold"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="rounded-tile border-line bg-surface mt-2 w-full border p-3">
      <ActionForm
        action={updateCatalogueItemAction}
        submitLabel="Save"
        submittingLabel="Saving…"
        onSuccess={() => setOpen(false)}
      >
        <input type="hidden" name="itemId" value={item.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Name
            </span>
            <input
              type="text"
              name="name"
              required
              defaultValue={item.name}
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Expires after (months)
            </span>
            <input
              type="number"
              name="validityMonths"
              min="1"
              defaultValue={item.validityMonths ?? ""}
              placeholder="blank for never"
              className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink mt-3 mr-3 text-sm font-semibold"
        >
          Cancel
        </button>
      </ActionForm>

      {/*
        Who signs this off.

        Three states, and all three are reachable from here: a named person,
        self-verify, or neither. "Neither" is not a broken state — it falls back
        to any Lead, which is what a thirty-item catalogue looks like before
        anybody has been through it, and locking those items would keep people
        out of the shop.
      */}
      <div className="border-line mt-3 border-t pt-3">
        <ActionForm
          action={setCatalogueVerifierAction}
          submitLabel="Save who verifies"
          submittingLabel="Saving…"
        >
          <input type="hidden" name="itemId" value={item.id} />
          <input
            type="hidden"
            name="selfVerify"
            value={selfVerify ? "yes" : "no"}
          />

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selfVerify}
              onChange={(e) => setSelfVerify(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="text-ink block text-sm font-semibold">
                Members tick this one themselves
              </span>
              <span className="text-ink-muted block text-xs">
                For anything where the honest answer is &ldquo;did you read
                this&rdquo; — an induction video, a document. Nobody is asked to
                sign it off, so it never sits in a queue.
              </span>
            </span>
          </label>

          {/*
            Hidden rather than disabled when self-verify is on. A greyed-out
            picker next to a ticked box reads as "you can also choose somebody",
            and the two settings are mutually exclusive — the SQL has a CHECK
            constraint saying so.
          */}
          {selfVerify ? null : (
            <label className="mt-3 block">
              <span className="text-ink mb-1 block text-sm font-semibold">
                Verified by
              </span>
              <select
                name="verifierId"
                defaultValue={verifier?.verifierId ?? ""}
                className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
              >
                <option value="">Any Lead (nobody named)</option>
                {verifierOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </select>
              <span className="text-ink-muted mt-1 block text-xs">
                Naming somebody puts requests for this on their dashboard, and
                nobody else can sign it off. They can&apos;t be demoted or
                deactivated while it&apos;s assigned to them — reassign it
                first.
              </span>
            </label>
          )}
        </ActionForm>
      </div>

      <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
        <ActionButton
          action={setCatalogueItemActiveAction}
          fields={{ itemId: item.id, isActive: item.isActive ? "no" : "yes" }}
          label={item.isActive ? "Retire" : "Bring back"}
          pendingLabel="Saving…"
          tone={item.isActive ? "danger" : "primary"}
        />
        <span className="text-ink-muted text-xs">
          Retiring hides it from the list. People already cleared keep the
          record — deleting it would erase who was trained on what.
        </span>
      </div>
    </div>
  );
}
