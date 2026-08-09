import Link from "next/link";
import { Archive, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { CreateTeamForm, EditTeamForm } from "@/components/forms/team-admin";
import { CreateProjectForm } from "@/components/forms/project-admin";
import { Card, CardBody } from "@/components/ui/card";
import {
  HideCompletedProvider,
  HideCompletedToggle,
} from "@/components/ui/completed-filter";
import { DivisionExtras } from "@/components/ui/division-extras";
import { EmptyState } from "@/components/ui/empty-state";
import { DivisionProjectList } from "@/components/ui/project-tree";
import { SectionLabel } from "@/components/ui/section-label";
import { getDivisionExtras } from "@/lib/data/deadlines";
import {
  countArchivedDivisions,
  getOrphanedProjects,
  getProjectFormOptions,
  getProjectTree,
} from "@/lib/data/projects";
import { getViewer } from "@/lib/data/viewer";
import { can, isCoLead } from "@/lib/permissions";
import type { ProjectTreeNode } from "@/lib/data/projects";

/** Completed projects anywhere in a division's tree, not just at the top. */
function countCompleted(nodes: ProjectTreeNode[]): number {
  return nodes.reduce(
    (total, node) =>
      total +
      (node.project.phase === "complete" ? 1 : 0) +
      countCompleted(node.children),
    0
  );
}

export default async function ProjectsPage() {
  const viewer = await getViewer();
  const [tree, orphans, formOptions, archivedCount, extras] = await Promise.all(
    [
      getProjectTree(),
      getOrphanedProjects(),
      // Scoped to what this viewer may actually create — a Lead only sees
      // divisions they lead, so the dropdown can't offer a failing option.
      getProjectFormOptions(viewer),
      countArchivedDivisions(),
      // Deadlines and blocked work, folded in here rather than being two
      // separate pages. Computed in one pass and looked up per division.
      getDivisionExtras(),
    ]
  );

  /*
    Can they file work ANYWHERE?

    `can.createProject` needs a target, and this button has none yet — so the
    answer is "is there at least one division they could pick", which is
    exactly what `getProjectFormOptions` already filtered for them. A Lead who
    leads no team gets no button rather than a dropdown that rejects every
    option.
  */
  const mayCreate = isCoLead(viewer.actor) || formOptions.divisions.length > 0;
  const mayManageTeams = can.manageTeams(viewer.actor);
  const todayIso = new Date().toISOString().slice(0, 10);
  const completedCount = tree.reduce(
    (total, { roots }) => total + countCompleted(roots),
    0
  );

  return (
    <HideCompletedProvider>
      <div className="space-y-6">
        <PageHeader
          label="All Divisions"
          title="Projects"
          description="Everything the club is building, grouped by division. Follow anything to keep an eye on it; to actually join, ask the project's RE — they decide, and the ask is tracked."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/*
              Available to everyone, not just leadership. Reading the page is
              the one thing every member does here, and how much finished work
              you want in the way of that is a personal preference.
            */}
              <HideCompletedToggle count={completedCount} />
              {mayCreate ? (
                <>
                  {mayManageTeams ? (
                    <CreateTeamForm
                      divisions={formOptions.divisions}
                      people={formOptions.people}
                    />
                  ) : null}
                  <CreateProjectForm
                    parents={formOptions.parents}
                    divisions={formOptions.divisions}
                    people={formOptions.people}
                    defaultReId={viewer.member.id}
                  />
                </>
              ) : null}
            </div>
          }
        />

        {/* Data-integrity warning rather than silently hiding work */}
        {orphans.length > 0 ? (
          <Card className="border-warn-fg/25 bg-warn-bg">
            <CardBody className="py-4">
              <p className="text-warn-fg flex items-start gap-2 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-semibold">
                    {orphans.length} project
                    {orphans.length === 1 ? "" : "s"} not linked to a division:
                  </span>{" "}
                  {orphans.map((p) => p.name).join(", ")}. Assign each an owning
                  team so members can find them.
                </span>
              </p>
            </CardBody>
          </Card>
        ) : null}

        {/*
          The first screen of a brand-new club.

          Without this the page rendered an empty div — no divisions, no
          message, nothing to press. Whoever is setting the club up opens this
          page first, so it has to say what a division IS and offer the button,
          rather than looking broken.
        */}
        {tree.length === 0 ? (
          <Card>
            <CardBody>
              {mayManageTeams ? (
                /*
                  The form itself, not a pointer to it.

                  `EmptyState` requires a next action for good reason, and the
                  honest action here is the button that fixes the emptiness —
                  it's already in the page header, but a first-time Co-Lead is
                  reading the middle of the page, not scanning the corner.
                */
                <>
                  <SectionLabel>Nothing here yet</SectionLabel>
                  <h2 className="text-ink mt-2 text-xl font-bold">
                    Start with a division
                  </h2>
                  <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
                    A division is a top-level part of the club — Airframe,
                    Avionics, Autonomy — and every project lives inside one.
                    Create the first, then add projects to it. Members will see
                    them on Find Work straight away.
                  </p>
                  <div className="mt-4">
                    <CreateTeamForm
                      divisions={formOptions.divisions}
                      people={formOptions.people}
                    />
                  </div>
                </>
              ) : (
                <EmptyState
                  message="The club hasn't set up any divisions yet, so there are no projects to show. A Co-Lead does that, and everything appears here once they have."
                  actionLabel="See what needs doing"
                  actionHref="/find-work"
                />
              )}
            </CardBody>
          </Card>
        ) : null}

        <div className="space-y-6">
          {tree.map(({ division, lead, roots }) => (
            <Card key={division.id}>
              <CardBody>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <SectionLabel>Division</SectionLabel>
                      {mayManageTeams ? (
                        <EditTeamForm
                          team={{
                            id: division.id,
                            name: division.name,
                            parentId: division.parentId,
                            leadId: division.leadId,
                          }}
                          divisions={formOptions.divisions}
                          people={formOptions.people}
                        />
                      ) : null}
                    </div>
                    <h2 className="text-ink mt-1.5 text-2xl font-bold">
                      {division.name}
                    </h2>
                    {division.description ? (
                      <p className="text-ink-soft mt-1.5 text-[15px]">
                        {division.description}
                      </p>
                    ) : null}
                  </div>
                  {lead ? (
                    <div className="text-right">
                      <SectionLabel tone="muted">Division Lead</SectionLabel>
                      <Link
                        href={`/members/${lead.id}`}
                        className="text-ink hover:text-cardinal-600 mt-1 block text-[15px] font-bold"
                      >
                        {lead.fullName}
                      </Link>
                    </div>
                  ) : null}
                </div>

                <DivisionProjectList roots={roots} />

                {/*
                What's due and what's stuck, both collapsed. These were
                `/deadlines` and `/blockers` — neither was wrong, both were the
                wrong size. A deadline is a property of a project and a blocker
                is already flagged on the row above; making each a destination
                asked people to navigate away to learn about the thing they
                were already reading.
              */}
                <DivisionExtras
                  deadlines={extras[division.id]?.deadlines ?? []}
                  timeline={extras[division.id]?.timeline ?? null}
                  blocked={extras[division.id]?.blocked ?? []}
                  today={todayIso}
                />
              </CardBody>
            </Card>
          ))}
        </div>

        {/*
        The way back to what was retired.
        Archiving a division only makes sense if the history is reachable —
        otherwise it's a delete with extra steps, and the club loses its record
        of what it built. Shown to everyone; restoring is the Co-Lead part.
      */}
        {archivedCount > 0 ? (
          <Link
            href="/projects/archive"
            className="rounded-tile border-line text-ink-soft hover:bg-surface hover:text-ink flex items-center gap-2 border px-4 py-3 text-sm font-semibold transition-colors"
          >
            <Archive className="size-4 shrink-0" />
            Archive · {archivedCount} retired division
            {archivedCount === 1 ? "" : "s"} and what they built
          </Link>
        ) : null}
      </div>
    </HideCompletedProvider>
  );
}
