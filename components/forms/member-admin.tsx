"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";

import { ActionButton, ActionForm } from "./action-form";
import {
  inviteMemberAction,
  setGlobalRoleAction,
  setMemberLeadAction,
  setMemberStatusAction,
} from "@/lib/actions";
import type { GlobalRole, MemberStatus } from "@/lib/types";

export interface PersonOption {
  id: string;
  fullName: string;
}

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
  leads,
  canAppointLeadership,
  defaultLeadId,
}: {
  leads: PersonOption[];
  canAppointLeadership: boolean;
  defaultLeadId?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-tile bg-cardinal-600 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-cardinal-700"
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
      className="w-full rounded-card border border-line bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Name</span>
          <input
            type="text"
            name="fullName"
            required
            placeholder="Jordan Reyes"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Stanford email
          </span>
          <input
            type="email"
            name="email"
            required
            placeholder="jreyes@stanford.edu"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Phone <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="tel"
            name="phone"
            placeholder="(650) 555-0142"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Shown instead of their email wherever people need to reach them.
            They can change it later.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Reports to
          </span>
          <select
            name="leadId"
            defaultValue={defaultLeadId ?? ""}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          >
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.fullName}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-muted">
            Whoever reads their check-ins. Defaults to you.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Role</span>
          <select
            name="globalRole"
            defaultValue="member"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          >
            <option value="member">Member</option>
            {canAppointLeadership ? (
              <>
                <option value="lead">Team Lead</option>
                <option value="co_lead">Co-Lead</option>
              </>
            ) : null}
          </select>
          {!canAppointLeadership ? (
            <span className="mt-1 block text-xs text-ink-muted">
              Only a Co-Lead can invite someone as leadership.
            </span>
          ) : null}
        </label>
      </div>

      <p className="mb-3 mt-3 text-xs text-ink-muted">
        They appear on the roster straight away and become a real account the
        first time they sign in with that address.
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
  leadId,
  leadOptions,
  canSetRole,
  canReassign,
  canSetStatus,
}: {
  memberId: string;
  memberName: string;
  role: GlobalRole;
  status: MemberStatus;
  leadId: string | null;
  leadOptions: PersonOption[];
  canSetRole: boolean;
  canReassign: boolean;
  canSetStatus: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canSetRole && !canReassign && !canSetStatus) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
      >
        Manage
      </button>
    );
  }

  return (
    <div className="mt-3 w-full space-y-3 rounded-tile border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-ink">Managing {memberName}</p>
        <button
          onClick={() => setOpen(false)}
          className="text-sm font-semibold text-ink-muted hover:text-ink"
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
            <span className="mb-1 block text-sm font-semibold text-ink">
              Role
            </span>
            <select
              name="role"
              defaultValue={role}
              className="mb-2 w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="member">Member</option>
              <option value="lead">Team Lead</option>
              <option value="co_lead">Co-Lead</option>
            </select>
          </label>
        </ActionForm>
      ) : null}

      {canReassign ? (
        <ActionForm
          action={setMemberLeadAction}
          submitLabel="Change lead"
          submittingLabel="Saving…"
        >
          <input type="hidden" name="memberId" value={memberId} />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">
              Reports to
            </span>
            <select
              name="leadId"
              defaultValue={leadId ?? ""}
              className="mb-2 w-full rounded-tile border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">Nobody (top of the chain)</option>
              {leadOptions
                .filter((l) => l.id !== memberId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.fullName}
                  </option>
                ))}
            </select>
          </label>
        </ActionForm>
      ) : null}

      {canSetStatus ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
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
              <span className="text-xs text-ink-muted">
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
    </div>
  );
}
