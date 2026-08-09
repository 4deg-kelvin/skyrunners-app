import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import {
  InviteMemberForm,
  MemberAdminControls,
} from "@/components/forms/member-admin";
import { Badge } from "@/components/ui/badge";
import { AccessIssues } from "@/components/ui/access-issues";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { getRoster, getRosterOptions } from "@/lib/data/members";
import { getViewer } from "@/lib/data/viewer";
import { ROLE_LABELS, ROLE_TONES } from "@/lib/labels";
import { can, isCoLead } from "@/lib/permissions";

export default async function MembersPage() {
  const [roster, options, viewer] = await Promise.all([
    getRoster(),
    getRosterOptions(),
    getViewer(),
  ]);
  const mayInvite = can.inviteMember(viewer.actor);

  /*
    Two ways to be locked out, and the roster showed them identically.

    `lastActiveAt` is the discriminator: set means they've signed in at least
    once, so an inactive row is one click from working. Undefined means the row
    has never been used — nearly always because the invite email isn't the
    address Google returns, in which case inviting them again just creates a
    second row that also never links.
  */
  const lockedOut = roster.filter(({ member }) => member.status !== "active");
  const waitingForActivation = lockedOut
    .filter(({ member }) => member.lastActiveAt)
    .map(({ member }) => member);
  const neverSignedIn = roster
    .filter(({ member }) => !member.lastActiveAt && member.status !== "alumni")
    .map(({ member }) => member);
  const mayAppointLeadership = isCoLead(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Roster"
        title="Members"
        description={`${roster.length} active members. Who's on what, and what they're cleared to use, is public. Total hours and personal reports stay between a member and their Lead.`}
        action={
          mayInvite ? (
            <InviteMemberForm
              leads={options.leadOptions}
              canAppointLeadership={mayAppointLeadership}
              defaultLeadId={viewer.member.id}
            />
          ) : undefined
        }
      />

      {/*
        Shown only to whoever can actually fix it, and only when there IS
        something to fix. A standing "0 access issues" panel is how a page
        teaches you to skip a section.
      */}
      {mayInvite ? (
        <AccessIssues
          waitingForActivation={waitingForActivation}
          neverSignedIn={neverSignedIn}
        />
      ) : null}

      <Card>
        <CardBody>
          <SectionLabel>All Members</SectionLabel>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {roster.map(
              ({
                member,
                lead,
                leads,
                committedCount,
                reCount,
                deliverablesCompleted,
                overdueDeliverables,
              }) => (
                // A div, not a Link. The card now holds admin controls, and
                // buttons cannot be nested inside an anchor — the name below
                // carries the link instead.
                <div
                  key={member.id}
                  className="rounded-tile border-line border px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={member.fullName}
                      photoUrl={member.photoUrl}
                      className="size-11 text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/members/${member.id}`}
                          className="text-ink hover:text-cardinal-600 truncate text-[15px] font-bold"
                        >
                          {member.fullName}
                        </Link>
                        {member.globalRole !== "member" ? (
                          <Badge tone={ROLE_TONES[member.globalRole]}>
                            {ROLE_LABELS[member.globalRole]}
                          </Badge>
                        ) : null}
                        {/*
                          WHAT they lead, not just that they do.

                          "Lead" alone doesn't say whether somebody runs a
                          whole division — which makes them a top RE over every
                          project inside it — or one sub-team. This page is
                          where people answer "who do I ask about this?", so it
                          has to name the unit.
                        */}
                        {leads.map((unit) => (
                          <Badge
                            key={unit.id}
                            tone={unit.isDivision ? "cardinal" : "neutral"}
                          >
                            {unit.name}
                            {unit.isDivision ? " Lead" : " sub-team"}
                          </Badge>
                        ))}
                        {/* Alumni and deactivated people stay on the roster so
                            they can be brought back. Say which they are. */}
                        {member.status !== "active" ? (
                          <Badge tone="neutral">
                            {member.status === "alumni"
                              ? "Alumni"
                              : "Deactivated"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-ink-muted mt-0.5 truncate text-sm">
                        {member.major}
                        {member.classYear
                          ? ` · '${String(member.classYear).slice(2)}`
                          : ""}
                      </p>

                      <div className="text-ink-soft mt-2.5 space-y-1 text-sm">
                        {/* Delivered work leads — it's the public, honest signal */}
                        <p>
                          <span className="text-ink font-semibold">
                            {deliverablesCompleted}
                          </span>{" "}
                          delivered
                          {overdueDeliverables > 0 ? (
                            <span className="text-cardinal-600">
                              {" "}
                              · {overdueDeliverables} overdue
                            </span>
                          ) : null}
                        </p>
                        <p>
                          {committedCount}{" "}
                          {committedCount === 1 ? "project" : "projects"}
                          {reCount > 0 ? (
                            <span className="text-cardinal-600 font-semibold">
                              {" "}
                              · RE on {reCount}
                            </span>
                          ) : null}
                        </p>
                        {lead ? (
                          <p className="text-ink-muted">
                            Reports to {lead.fullName}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-3">
                        <MemberAdminControls
                          memberId={member.id}
                          memberName={member.fullName}
                          role={member.globalRole}
                          status={member.status}
                          leadId={member.leadId}
                          leadOptions={options.leadOptions}
                          canSetRole={can.setGlobalRole(
                            viewer.actor,
                            member.id
                          )}
                          canReassign={can.reassignLead(
                            viewer.actor,
                            viewer.graph,
                            member.id
                          )}
                          canSetStatus={can.setMemberStatus(
                            viewer.actor,
                            viewer.graph,
                            member.id
                          )}
                          canDelete={can.deleteMember(viewer.actor, member.id)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
