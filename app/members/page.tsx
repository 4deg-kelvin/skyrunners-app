import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { activeMembers, getMember, memberProjects } from "@/lib/mock-data";
import { ROLE_LABELS, type GlobalRole } from "@/lib/types";
import { initials } from "@/lib/utils";

const roleTone: Record<GlobalRole, "cardinal" | "neutral"> = {
  co_lead: "cardinal",
  lead: "cardinal",
  member: "neutral",
};

export default function MembersPage() {
  const roster = activeMembers();

  return (
    <div className="space-y-6">
      <PageHeader
        label="Roster"
        title="Members"
        description={`${roster.length} active members. Anyone can see who's on what — hours and updates stay with leadership.`}
        action={<Button>Invite member</Button>}
      />

      <Card>
        <CardBody>
          <SectionLabel>All Members</SectionLabel>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {roster.map((member) => {
              const lead = member.leadId ? getMember(member.leadId) : null;
              const projectCount = memberProjects(member.id).length;
              const reCount = memberProjects(member.id).filter(
                (p) => p.role === "re"
              ).length;

              return (
                <Link
                  key={member.id}
                  href={`/members/${member.id}`}
                  className="rounded-tile border border-line px-4 py-4 transition-colors hover:bg-surface"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cardinal-50 text-sm font-bold text-cardinal-600">
                      {initials(member.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[15px] font-bold text-ink">
                          {member.fullName}
                        </p>
                        {member.globalRole !== "member" ? (
                          <Badge tone={roleTone[member.globalRole]}>
                            {ROLE_LABELS[member.globalRole]}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-muted">
                        {member.major}
                        {member.classYear ? ` · '${String(member.classYear).slice(2)}` : ""}
                      </p>

                      <div className="mt-2.5 space-y-1 text-sm text-ink-soft">
                        <p>
                          {projectCount}{" "}
                          {projectCount === 1 ? "project" : "projects"}
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
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
