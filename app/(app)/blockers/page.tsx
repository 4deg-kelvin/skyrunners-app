import Link from "next/link";
import { CircleCheck, MessageSquare, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  AskForHelpForm,
  DeleteAskButton,
  ReopenButton,
  ReplyForm,
  ResolveForm,
} from "@/components/forms/help-request-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { ContactLink } from "@/components/ui/contact-link";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { getBlockerBoard, type BlockerItem } from "@/lib/data/blockers";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Blockers · SkyRunners HQ",
};

const SOURCE_LABELS: Record<BlockerItem["source"], string> = {
  deliverable: "Blocked work",
  check_in: "From a check-in",
  ask: "Asked for help",
};

/**
 * Everything in the club that's stuck, oldest first.
 *
 * Three sources merged: deliverables somebody marked blocked, blockers written
 * into check-ins, and free-form asks. The first two already existed and were
 * invisible — a blocked deliverable sat on a project page and a check-in
 * blocker sat in one Lead's queue, neither anywhere the person who knows the
 * answer would look.
 *
 * Age-sorted, always. "14 open blockers" is a number people scroll past;
 * "nobody has answered Kenji in 6 days" names one person and is actionable.
 */
export default async function BlockersPage() {
  const viewer = await getViewer();
  const view = await getBlockerBoard(viewer.member.id);
  const { open, resolved, projectOptions, myOpenCount } = view;

  const stale = open.filter((item) => item.stale);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Help Wanted"
        title="Blockers"
        description="Everything in the club that's stuck, oldest first. Anyone can answer — you don't have to be on the project."
        action={<AskForHelpForm projects={projectOptions} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open" value={open.length} />
        <StatTile
          label="Waiting 3+ days"
          value={stale.length}
          hint={stale.length > 0 ? "Someone is stuck" : undefined}
        />
        <StatTile label="Yours" value={myOpenCount} />
      </div>

      <Card>
        <CardBody>
          <SectionLabel>Open</SectionLabel>

          <div className="mt-4 space-y-3">
            {open.length === 0 ? (
              <EmptyState
                message="Nothing is blocked right now. If you're stuck on something, post it — that's what this page is for."
                actionLabel="Find work instead"
                actionHref="/find-work"
              />
            ) : (
              open.map((item) => {
                const request = item.request;
                const mayClose =
                  !!request &&
                  can.resolveHelpRequest(
                    viewer.actor,
                    request.memberId,
                    request.replies.map((r) => r.memberId)
                  );
                const mayDelete =
                  !!request &&
                  can.deleteHelpRequest(viewer.actor, request.memberId);

                return (
                  <div
                    key={item.key}
                    className={`rounded-tile border px-4 py-3.5 ${
                      item.stale ? "border-warn-fg/30 bg-warn-bg/40" : "border-line"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold text-ink">
                            {item.title}
                          </span>
                          <Badge tone="neutral">
                            {SOURCE_LABELS[item.source]}
                          </Badge>
                        </div>

                        <p className="mt-1 text-sm text-ink-muted">
                          {item.member ? item.member.fullName : "Unknown member"}
                          {item.project ? (
                            <>
                              {" · "}
                              <Link
                                href={`/projects/${item.project.slug}`}
                                className="font-semibold text-cardinal-600 hover:text-cardinal-700"
                              >
                                {item.project.name}
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>

                      {/*
                        Age, not a count badge. This is the number that makes
                        somebody act.
                      */}
                      <Badge tone={item.stale ? "risk" : "warn"}>
                        {item.ageDays === 0
                          ? "Today"
                          : `${item.ageDays}d waiting`}
                      </Badge>
                    </div>

                    {item.detail ? (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-cardinal-600" />
                        <span>{item.detail}</span>
                      </p>
                    ) : null}

                    {/* How to reach them, right here — same rule as Find Work. */}
                    {item.member ? (
                      <ContactLink
                        member={item.member}
                        showLabel={false}
                        className="mt-2"
                      />
                    ) : null}

                    {request && request.replies.length > 0 ? (
                      <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
                        {request.replies.map((reply, i) => (
                          <div key={reply.id}>
                            <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                              <MessageSquare className="size-3" />
                              {item.repliers[i]?.fullName ?? "Someone"}
                            </p>
                            <p className="mt-0.5 text-sm text-ink-soft">
                              {reply.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {request ? (
                        <>
                          <ReplyForm requestId={request.id} />
                          {mayClose ? (
                            <ResolveForm requestId={request.id} />
                          ) : null}
                          {mayDelete ? (
                            <DeleteAskButton requestId={request.id} />
                          ) : null}
                        </>
                      ) : (
                        /*
                          A blocked deliverable or a check-in blocker is
                          answered where it lives — on the project, by its RE.
                          Duplicating the controls here would create two places
                          to clear one thing and let them disagree.
                        */
                        item.project && (
                          <Link
                            href={`/projects/${item.project.slug}`}
                            className="text-sm font-semibold text-cardinal-600 hover:text-cardinal-700"
                          >
                            Open the project to clear this
                          </Link>
                        )
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardBody>
      </Card>

      {/*
        Resolved asks are kept, not deleted. The note on how something got
        sorted is the useful half — it's how the next person with the same
        problem finds the answer without asking again.
      */}
      {resolved.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel tone="muted">
              Sorted · {resolved.length}
            </SectionLabel>
            <div className="mt-3 space-y-2.5">
              {resolved.map((item) => (
                <div
                  key={item.key}
                  className="rounded-tile border border-line px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[15px] font-bold text-ink">
                        <CircleCheck className="size-4 shrink-0 text-ok-fg" />
                        {item.title}
                      </p>
                      {item.request?.resolutionNote ? (
                        <p className="mt-1 text-sm text-ink-soft">
                          {item.request.resolutionNote}
                        </p>
                      ) : null}
                    </div>
                    {item.request &&
                    can.resolveHelpRequest(
                      viewer.actor,
                      item.request.memberId,
                      item.request.replies.map((r) => r.memberId)
                    ) ? (
                      <ReopenButton requestId={item.request.id} />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
