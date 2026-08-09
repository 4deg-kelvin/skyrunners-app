import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import {
  InviteMemberForm,
  MemberAdminControls,
} from "@/components/forms/member-admin";
import { Badge } from "@/components/ui/badge";
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
  const mayAppointLeadership = isCoLead(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Roster"
        title="Members"
        description={`${roster.length} active members. Anyone can see who's on what — hours and updates stay with leadership.`}
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

      <Card>
        <CardBody>
          <SectionLabel>All Members</SectionLabel>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {roster.map(
              ({
                member,
                lead,
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
                  className="rounded-tile border border-line px-4 py-4"
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
                          className="truncate text-[15px] font-bold text-ink hover:text-cardinal-600"
                        >
                          {member.fullName}
                        </Link>
                        {member.globalRole !== "member" ? (
                          <Badge tone={ROLE_TONES[member.globalRole]}>
                            {ROLE_LABELS[member.globalRole]}
                          </Badge>
                        ) : null}
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
                      <p className="mt-0.5 truncate text-sm text-ink-muted">
                        {member.major}
                        {member.classYear
                          ? ` · '${String(member.classYear).slice(2)}`
                          : ""}
                      </p>

                      <div className="mt-2.5 space-y-1 text-sm text-ink-soft">
                        {/* Delivered work leads — it's the public, honest signal */}
                        <p>
                          <span className="font-semibold text-ink">
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
                            <span className="font-semibold text-cardinal-600">
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
                          canSetRole={can.setGlobalRole(viewer.actor, member.id)}
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
