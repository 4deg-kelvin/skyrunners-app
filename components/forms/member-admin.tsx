"use client";

import { useState } from "react";
import { Check, Copy, UserPlus, X } from "lucide-react";

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
  joinUrl,
}: {
  canAppointLeadership: boolean;
  /**
   * The sign-in page, absolute, for handing to somebody who isn't here yet.
   *
   * Built on the server with `appUrl` because that is where the host lives —
   * `NEXT_PUBLIC_SITE_URL`, then Vercel's stable production domain. Deriving it
   * from `window.location` would put a preview deployment's throwaway hostname
   * into a link somebody pastes into Discord.
   *
   * **Deliberately NOT a token.** See the note beside the block that renders it.
   */
  joinUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
    <div className="rounded-card border-line bg-card w-full border p-4">
      {/* Same header close as the project and deliverable panels. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-ink text-sm font-bold">Add someone to the roster</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-muted hover:text-ink hover:bg-surface rounded-tile -mr-1 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold transition-colors"
        >
          <X className="size-3.5" />
          Close
        </button>
      </div>

      <ActionForm
        action={inviteMemberAction}
        submitLabel="Send invite"
        submittingLabel="Inviting…"
        resetOnSuccess
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
              Phone{" "}
              <span className="text-ink-muted font-normal">(optional)</span>
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
      </ActionForm>

      {/*
        The other way in: a link, for when you do not want to type six people's
        addresses.

        ---------------------------------------------------------------------
        Why this is NOT a tokenised invite link
        ---------------------------------------------------------------------

        It is the plain sign-in URL, shareable by anyone, and that is safe
        because the gates are already there and are not this link:

          1. Google OAuth accepts `@stanford.edu` only, checked again in
             `lib/env.ts` and a third time by the `profiles_stanford_email`
             CHECK. Forwarding this to somebody outside Stanford achieves
             nothing.
          2. A Stanford sign-in with no pre-created profile gets an INACTIVE
             one — `handle_new_auth_user` in migration `0005` — so they land on
             `/auth/inactive` and appear on this page under "waiting for
             activation" until a Lead clicks. Following the link does not put
             anybody on the roster.

        So a token would add an expiry, a revocation path, an audit trail and a
        bearer secret that leaks by being pasted into Discord, to guard a door
        that is already locked twice. The honest version of "invite link" here
        is "here is where to sign in", and the sentence below says what happens
        next so nobody expects it to skip the review.

        The one thing it genuinely changes: the invite form pre-creates the
        profile, so an invited person is active the moment they first sign in.
        Link arrivals wait for a click. That is a real difference and it is
        stated rather than buried.
      */}
      <div className="border-line mt-4 border-t pt-3.5">
        <p className="text-ink text-sm font-bold">Or send them this link</p>
        <p className="text-ink-muted mt-1 text-xs">
          They sign in with their Stanford account and show up here under people
          waiting to be activated — one click and they&apos;re on. Use this for
          a whole intake at once; use the form above when you want somebody
          active the moment they first sign in.
        </p>

        {/*
          A localhost link is a broken link, said out loud.

          `appUrl` falls back to localhost when neither NEXT_PUBLIC_SITE_URL nor
          Vercel s domain variables are set. Somebody would otherwise paste that
          into Discord and wonder why nobody could open it — and the person who
          can fix it is the one reading this panel.
        */}
        {joinUrl.startsWith("http://localhost") ? (
          <p className="text-warn-fg mt-2 text-xs font-medium">
            This link points at localhost, so it only works on this machine. Set
            NEXT_PUBLIC_SITE_URL in the deployment and it becomes the real
            address.
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-tile border-line bg-surface text-ink min-w-0 flex-1 overflow-x-auto border px-3 py-2 text-xs">
            {joinUrl}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(joinUrl);
              setCopied(true);
            }}
            className="rounded-tile border-line hover:bg-surface text-ink inline-flex shrink-0 items-center gap-1.5 border px-3 py-2 text-sm font-semibold transition-colors"
          >
            {copied ? (
              <Check className="size-4" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
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
              but runs nothing: no projects, no deliverables and no PL roles.
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
        Lead rather than being orphaned. Refused if they&apos;re the primary PL
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
