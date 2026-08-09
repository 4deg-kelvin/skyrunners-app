import { DoorOpen, TriangleAlert, Wrench } from "lucide-react";

import {
  RequestTrainingForm,
  RevokeButton,
  VerifyControls,
} from "@/components/forms/training-actions";
import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/section-label";
import {
  CERTIFICATION_STATUS_LABELS,
  CERTIFICATION_STATUS_TONES,
} from "@/lib/labels";
import type { TrainingsView } from "@/lib/data/trainings";

/**
 * One person's trainings and site access, as shown on their profile.
 *
 * ---------------------------------------------------------------------------
 * Why this is on the profile and not its own page
 * ---------------------------------------------------------------------------
 *
 * It had a top-level page for about a day. That was wrong: "what am I cleared
 * to use" is a fact ABOUT A PERSON, and the profile is already the page that
 * answers questions about a person. A separate tab meant the roster told you
 * who somebody was and a different tab told you what they could do, with
 * nothing linking them at the moment you needed both.
 *
 * **Everything here is per-person.** Nothing on this component changes the
 * club's catalogue — retiring a machine or adding one lives in Settings,
 * because that's a club-wide act and it has no business sitting on a row
 * inside one member's record.
 */
export function TrainingRecord({
  view,
  isOwnProfile,
  canVerify,
  viewerIsCoLead,
}: {
  view: TrainingsView;
  /** Only you can say you've done a training. */
  isOwnProfile: boolean;
  /** Their Lead chain, or a Co-Lead. */
  canVerify: boolean;
  /** A Co-Lead may sign off their own — nobody sits above them. */
  viewerIsCoLead: boolean;
}) {
  const { member, sections, retiredHeld, counts, today } = view;
  const firstName = member.preferredName ?? member.fullName.split(" ")[0];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>Trainings &amp; Facility Access</SectionLabel>
        <span className="text-sm text-ink-muted">
          {counts.verified} cleared
          {counts.pending > 0 ? ` · ${counts.pending} awaiting` : ""}
          {counts.expired > 0 ? ` · ${counts.expired} lapsed` : ""}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        Site access gets you in the door; a machine training clears you on one
        machine inside it. Neither implies the other.
      </p>

      <div className="mt-4 space-y-5">
        {sections.map(({ section, siteAccess, machines }) => (
          <div key={section.id}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink">
              {section.name}
            </p>

            {siteAccess.length > 0 ? (
              <div className="mt-2">
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <DoorOpen className="size-3" />
                  Getting in
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {siteAccess.map((row) => (
                    <Row
                      key={row.item.id}
                      row={row}
                      today={today}
                      memberId={member.id}
                      memberName={firstName}
                      isOwnProfile={isOwnProfile}
                      canVerify={canVerify}
                      viewerIsCoLead={viewerIsCoLead}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {machines.length > 0 ? (
              <div className="mt-3">
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Wrench className="size-3" />
                  Machines
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {machines.map((row) => (
                    <Row
                      key={row.item.id}
                      row={row}
                      today={today}
                      memberId={member.id}
                      memberName={firstName}
                      isOwnProfile={isOwnProfile}
                      canVerify={canVerify}
                      viewerIsCoLead={viewerIsCoLead}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/*
        Retired entries they still hold. Kept because they earned it, and
        because vanishing a record silently looks like a bug.
      */}
      {retiredHeld.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <SectionLabel tone="muted">Retired from the catalogue</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {retiredHeld.map(({ item }) => (
              <Badge key={item.id} tone="neutral">
                {item.name}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  row,
  today,
  memberId,
  memberName,
  isOwnProfile,
  canVerify,
  viewerIsCoLead,
}: {
  row: TrainingsView["sections"][number]["machines"][number];
  today: string;
  memberId: string;
  memberName: string;
  isOwnProfile: boolean;
  canVerify: boolean;
  viewerIsCoLead: boolean;
}) {
  const { item, record, verifier } = row;

  // Recorded by the person it's about. Only a Co-Lead can do this, and saying
  // so plainly is the whole reason the exception is acceptable.
  const selfVerified =
    record?.status === "verified" && record.verifiedById === record.memberId;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-line px-3 py-2">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">{item.name}</span>
        {record ? (
          <Badge tone={CERTIFICATION_STATUS_TONES[record.status]}>
            {CERTIFICATION_STATUS_LABELS[record.status]}
          </Badge>
        ) : null}
        {selfVerified ? <Badge tone="neutral">Self-verified</Badge> : null}
        {record?.status === "verified" && record.expiresAt ? (
          <span className="text-xs text-ink-muted">
            until {record.expiresAt}
          </span>
        ) : null}
        {record?.status === "verified" && verifier && !selfVerified ? (
          <span className="text-xs text-ink-muted">by {verifier.fullName}</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {record?.status === "expired" ? (
          <span className="flex items-center gap-1 text-xs text-risk-fg">
            <TriangleAlert className="size-3" />
            Not cleared
          </span>
        ) : null}

        {/* Only you can claim a training. */}
        {isOwnProfile &&
        (!record ||
          record.status === "rejected" ||
          record.status === "expired") ? (
          <RequestTrainingForm item={item} today={today} />
        ) : null}

        {record?.status === "requested" ? (
          canVerify && (!isOwnProfile || viewerIsCoLead) ? (
            <VerifyControls
              certificationId={record.id}
              memberId={memberId}
              memberName={memberName}
            />
          ) : (
            <span className="text-xs text-ink-muted">Awaiting a Lead</span>
          )
        ) : null}

        {record?.status === "verified" && canVerify ? (
          <RevokeButton
            certificationId={record.id}
            memberId={memberId}
            itemName={item.name}
          />
        ) : null}
      </span>
    </div>
  );
}
