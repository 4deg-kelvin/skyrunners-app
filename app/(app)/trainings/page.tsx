import Link from "next/link";
import { DoorOpen, TriangleAlert, Wrench } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import {
  AddCatalogueItemForm,
  AddSectionForm,
  EditCatalogueItemForm,
  RequestTrainingForm,
  RevokeButton,
  VerifyControls,
} from "@/components/forms/training-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { StatTile } from "@/components/ui/stat-tile";
import { getTrainings, type CatalogueRow } from "@/lib/data/trainings";
import { getViewer } from "@/lib/data/viewer";
import {
  CERTIFICATION_STATUS_LABELS,
  CERTIFICATION_STATUS_TONES,
} from "@/lib/labels";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Trainings · SkyRunners HQ",
};

/**
 * What you're cleared to use, and who else is.
 *
 * The second half is the one that pays for the page. Certifications are what
 * silently block work — somebody can't do a task, nobody knows, and the task
 * sits. "Who can run the laser cutter" is the same question `/find-work`
 * answers about projects, so every row names the people who can.
 *
 * The catalogue is DATA: a Co-Lead adds a machine here and it appears on
 * everyone's list immediately, unearned. There is no enum of training names
 * anywhere in the codebase and there must not be one.
 */
export default async function TrainingsPage() {
  const viewer = await getViewer();
  const view = await getTrainings(viewer.member.id);
  const { sections, retiredHeld, counts, sectionOptions, today } = view;

  const mayEditCatalogue = can.manageTrainingCatalogue(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Trainings & Access"
        title="What I'm cleared to use"
        description="Site access gets you in the door; a machine training clears you on one machine inside it. Neither implies the other."
        action={
          mayEditCatalogue ? (
            <AddCatalogueItemForm sections={sectionOptions} />
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Verified" value={counts.verified} />
        <StatTile
          label="Awaiting your Lead"
          value={counts.pending}
          hint={counts.pending > 0 ? "Nudge them if it sits" : undefined}
        />
        <StatTile
          label="Expired"
          value={counts.expired}
          hint={counts.expired > 0 ? "Re-do these before using the kit" : undefined}
        />
      </div>

      {sections.map(({ section, siteAccess, machines }) => (
        <Card key={section.id}>
          <CardBody>
            <SectionLabel>{section.name}</SectionLabel>

            {siteAccess.length > 0 ? (
              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <DoorOpen className="size-3.5" />
                  Getting in
                </p>
                <div className="mt-2 space-y-2.5">
                  {siteAccess.map((row) => (
                    <CatalogueRowView
                      key={row.item.id}
                      row={row}
                      today={today}
                      viewerId={viewer.member.id}
                      mayEditCatalogue={mayEditCatalogue}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {machines.length > 0 ? (
              <div className="mt-5">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <Wrench className="size-3.5" />
                  Machines
                </p>
                <div className="mt-2 space-y-2.5">
                  {machines.map((row) => (
                    <CatalogueRowView
                      key={row.item.id}
                      row={row}
                      today={today}
                      viewerId={viewer.member.id}
                      mayEditCatalogue={mayEditCatalogue}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ))}

      {/*
        Retired entries you still hold. Shown rather than dropped: the machine
        left the shop but the record of who was trained on it is still part of
        your history, and silently vanishing it would look like a bug.
      */}
      {retiredHeld.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel tone="muted">Retired</SectionLabel>
            <p className="mt-2 text-sm text-ink-soft">
              No longer on the club&apos;s list. Kept because you earned it.
            </p>
            <div className="mt-3 space-y-2">
              {retiredHeld.map(({ item, record }) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-tile border border-line px-4 py-2.5 opacity-70"
                >
                  <span className="text-sm font-semibold text-ink">
                    {item.name}
                  </span>
                  {record ? (
                    <Badge tone={CERTIFICATION_STATUS_TONES[record.status]}>
                      {CERTIFICATION_STATUS_LABELS[record.status]}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {mayEditCatalogue ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <SectionLabel>Catalogue</SectionLabel>
                <p className="mt-2 text-sm text-ink-soft">
                  Adding a training is typing a name — no code change, no
                  deploy. New entries show up for every member straight away.
                </p>
              </div>
              <AddSectionForm />
            </div>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function CatalogueRowView({
  row,
  today,
  viewerId,
  mayEditCatalogue,
}: {
  row: CatalogueRow;
  today: string;
  viewerId: string;
  mayEditCatalogue: boolean;
}) {
  const { item, record, verifier, clearedMembers } = row;
  const others = clearedMembers.filter((m) => m.id !== viewerId);

  return (
    <div className="rounded-tile border border-line px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold text-ink">{item.name}</span>
            {record ? (
              <Badge tone={CERTIFICATION_STATUS_TONES[record.status]}>
                {CERTIFICATION_STATUS_LABELS[record.status]}
              </Badge>
            ) : null}
            {item.validityMonths ? (
              <Badge tone="neutral">
                Expires after {item.validityMonths} months
              </Badge>
            ) : null}
          </div>

          {record?.status === "verified" ? (
            <p className="mt-1 text-sm text-ink-muted">
              Verified{verifier ? ` by ${verifier.fullName}` : ""}
              {record.expiresAt ? ` · valid until ${record.expiresAt}` : ""}
            </p>
          ) : null}

          {record?.status === "expired" ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-risk-fg">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This lapsed — you&apos;re not cleared until it&apos;s redone.
                Your Lead has been told.
              </span>
            </p>
          ) : null}

          {record?.status === "rejected" && record.note ? (
            <p className="mt-1 text-sm text-ink-soft">{record.note}</p>
          ) : null}

          {/*
            Who else can do this. The reason a member opens this page about
            somebody other than themselves.
          */}
          {others.length > 0 ? (
            <p className="mt-1.5 text-sm text-ink-muted">
              <span className="font-semibold text-ink-soft">Can help:</span>{" "}
              {others.slice(0, 4).map((m, i) => (
                <span key={m.id}>
                  {i > 0 ? ", " : ""}
                  <Link
                    href={`/members/${m.id}`}
                    className="hover:text-cardinal-600"
                  >
                    {m.fullName}
                  </Link>
                </span>
              ))}
              {others.length > 4 ? ` and ${others.length - 4} more` : ""}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-ink-muted">
              Nobody in the club is cleared on this yet.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!record || record.status === "rejected" || record.status === "expired" ? (
            <RequestTrainingForm item={item} today={today} />
          ) : record.status === "requested" ? (
            /*
              No verify button on your own row, ever — not even for a Co-Lead.
              `can.verifyTraining` excludes self and so does the operation, so
              rendering one would offer a control guaranteed to be refused.
            */
            <span className="text-sm text-ink-muted">Waiting on your Lead</span>
          ) : null}

          {record?.status === "verified" ? (
            <RevokeButton
              certificationId={record.id}
              memberId={record.memberId}
              itemName={item.name}
            />
          ) : null}

          {mayEditCatalogue ? <EditCatalogueItemForm item={item} /> : null}
        </div>
      </div>
    </div>
  );
}
