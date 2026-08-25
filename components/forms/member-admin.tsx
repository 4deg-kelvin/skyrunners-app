"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  inviteMemberAction,
  setGlobalRoleAction,
  deleteMemberAction,
  setMemberStatusAction,
} from "@/lib/actions";
import type { GlobalRole, MemberStatus } from "@/lib/types";

/*
  `PersonOption` and `LEAD_GROUPS` lived here, for the grouped "reports to"
  picker on the invite form and the member admin card. Both went with the
  reporting chain on 2026-08-24 -- there is nobody to report to, so there is no
  list of candidates to group.
*/

/**
 * Invite someone onto the roster.
 *
 * The role dropdown only offers Lead and Co-Lead to a Co-Lead. Inviting someone
 * straight in as leadership is the same act as promoting them, so it carries the
 * same authority — otherwise the invite form would be a way around the role
 * control. The server enforces this too; hiding the options is just so nobody
 * is offered something that will be refused.
 */
export function InviteMemberForm({
  canAppointLeadership,
}: {
  canAppointLeadership: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
      >
        <UserPlus className="size-4" strokeWidth={2.5} />
        Invite member
      </button>
    );
  }

  return (
    <ActionForm
      action={inviteMemberAction}
      submitLabel="Send invite"
      submittingLabel="Inviting…"
      resetOnSuccess
      className="rounded-card border-line bg-card w-full border p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Name
          </span>
          <input
            type="text"
            name="fullName"
            required
            placeholder="Jordan Reyes"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Stanford email
          </span>
          <input
            type="email"
            name="email"
            required
            placeholder="jreyes@stanford.edu"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Phone <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="tel"
            name="phone"
            placeholder="(650) 555-0142"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            Shown instead of their email wherever people need to reach them.
            They can change it later.
          </span>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Role
          </span>
          <select
            name="globalRole"
            defaultValue="member"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          >
            <option value="member">Member</option>
            {/*
              Advisor is Co-Lead-gated with the leadership roles, even though it
              carries no authority. It's a standing outside seat at the club's
              whole record — every project, every check-in entry, every roster
              page — and who gets one is a Co-Lead's call, not a decision made
              in passing while inviting somebody.
            */}
            {canAppointLeadership ? (
              <>
                <option value="advisor">Advisor</option>
                <option value="lead">Team Lead</option>
                <option value="co_lead">Co-Lead</option>
              </>
            ) : null}
          </select>
          {!canAppointLeadership ? (
            <span className="text-ink-muted mt-1 block text-xs">
              Only a Co-Lead can invite someone as leadership.
            </span>
          ) : null}
        </label>
      </div>

      <p className="text-ink-muted mt-3 mb-3 text-xs">
        They appear on the roster straight away and become a real account the
        first time they sign in with that address.
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

/**
 * Per-member controls: role, reporting line, status.
 *
 * Collapsed behind "Manage" so the roster stays a roster. Most people opening
 * /members want to find someone, not administer them.
 */
export function MemberAdminControls({
  memberId,
  memberName,
  role,
  status,
  canSetRole,
  canSetStatus,
  canDelete,
}: {
  memberId: string;
  memberName: string;
  role: GlobalRole;
  status: MemberStatus;
  canSetRole: boolean;
  canSetStatus: boolean;
  /** Co-Lead only, and never their own record. */
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canSetRole && !canSetStatus && !canDelete) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-cardinal-600 hover:text-cardinal-700 text-sm font-semibold"
      >
        Manage
      </button>
    );
  }

  return (
    <div className="rounded-tile border-line bg-surface mt-3 w-full space-y-3 border p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-ink text-sm font-bold">Managing {memberName}</p>
        <button
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink text-sm font-semibold"
        >
          Done
        </button>
      </div>

      {canSetRole ? (
        <ActionForm
          action={setGlobalRoleAction}
          submitLabel="Change role"
          submittingLabel="Saving…"
        >
          <input type="hidden" name="memberId" value={memberId} />
          <label className="block">
            <span className="text-ink mb-1 block text-sm font-semibold">
              Role
            </span>
            <select
              name="role"
              defaultValue={role}
              className="rounded-tile border-line bg-card text-ink mb-2 w-full border px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="advisor">Advisor</option>
              <option value="lead">Team Lead</option>
              <option value="co_lead">Co-Lead</option>
            </select>
            <span className="text-ink-muted mt-1 mb-2 block text-xs">
              An <span className="text-ink font-semibold">Advisor</span> — a
              faculty or project advisor — sees and can comment on everything,
              but runs nothing: no projects, no deliverables and no RE roles.
            </span>
          </label>
        </ActionForm>
      ) : null}

      {canSetStatus ? (
        <div className="border-line flex flex-wrap items-center gap-2 border-t pt-3">
          {status === "active" ? (
            <>
              <ActionButton
                action={setMemberStatusAction}
                fields={{ memberId, status: "inactive" }}
                label="Deactivate"
                pendingLabel="Saving…"
                tone="danger"
              />
              <ActionButton
                action={setMemberStatusAction}
                fields={{ memberId, status: "alumni" }}
                label="Mark alumni"
                pendingLabel="Saving…"
              />
              <span className="text-ink-muted text-xs">
                Never deletes — their history stays on the projects.
              </span>
            </>
          ) : (
            <ActionButton
              action={setMemberStatusAction}
              fields={{ memberId, status: "active" }}
              label="Reactivate"
              pendingLabel="Saving…"
              tone="primary"
            />
          )}
        </div>
      ) : null}

      {canDelete ? (
        <DeleteMemberControl memberId={memberId} memberName={memberName} />
      ) : null}
    </div>
  );
}

/**
 * Delete a record outright. Co-Leads only, and never your own.
 *
 * ---------------------------------------------------------------------------
 * This is not "somebody left the club"
 * ---------------------------------------------------------------------------
 *
 * Deactivating is that, and it keeps their history — which is the standing
 * rule and stays. This is for a **broken row**, and the commonest by far is a
 * duplicate: somebody is invited as one address, signs in with another, and
 * the trigger that links invites to accounts finds no match and creates a
 * second inactive profile. One person, two records, one of which can never be
 * signed in to and clutters every picker in the app.
 *
 * Deactivating that row would leave it on the roster forever, marked as though
 * a real person had left.
 *
 * Two steps, and the second one names what will be lost, because the guard the
 * force flag overrides is the one protecting real work.
 */
function DeleteMemberControl({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [force, setForce] = useState(false);

  if (!confirming) {
    return (
      <div className="border-line mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
        <button
          onClick={() => setConfirming(true)}
          className="text-ink-muted hover:text-risk-fg text-sm font-semibold"
        >
          Delete record
        </button>
        <span className="text-ink-muted text-xs">
          For a duplicate or broken profile. To remove someone who left, use
          Deactivate — that keeps their history.
        </span>
      </div>
    );
  }

  return (
    <div className="border-line mt-3 border-t pt-3">
      <p className="text-ink text-sm font-semibold">
        Delete {memberName}&apos;s record permanently?
      </p>
      <p className="text-ink-muted mt-1 text-xs">
        Their project memberships, hours, check-ins, trainings and requests go
        with it. Anyone reporting to them moves up to {memberName}&apos;s own
        Lead rather than being orphaned. Refused if they&apos;re the primary RE
        of anything — hand those over first.
      </p>

      <label className="text-ink-soft mt-2 flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          They have signed-off work or submitted check-ins, and I still want to
          delete it. Only tick this for a duplicate profile — for a real person
          it erases their record from the club&apos;s history.
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ActionButton
          action={deleteMemberAction}
          fields={{ memberId, force: force ? "yes" : "no" }}
          label="Yes, delete it"
          pendingLabel="Deleting…"
          tone="danger"
        />
        <button
          onClick={() => {
            setConfirming(false);
            setForce(false);
          }}
          className="text-ink-muted hover:text-ink text-sm font-semibold"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
