import { Badge } from "./badge";
import { SectionLabel } from "./section-label";
import { StatTile } from "./stat-tile";
import {
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  WEEKLY_HOURS_EXPECTATION,
  type ContributionRecord,
} from "@/lib/contribution";
import { TIER_TONES } from "@/lib/labels";
import { formatNumber, formatPercent } from "@/lib/utils";

/**
 * The contribution record, as four separate signals.
 *
 * There is no composite number here on purpose. A single score invites
 * optimization; four honest columns invite judgment. Delivered comes first
 * because finished work is the only signal that can't be inflated — someone can
 * sit in the lab for twelve hours and ship nothing.
 *
 * Members see their own. Nobody sees a ranking.
 */
export function ContributionPanel({
  record,
  isOwnRecord,
}: {
  record: ContributionRecord;
  isOwnRecord: boolean;
}) {
  const { delivered, commitment, reliability, scope } = record;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>
          {isOwnRecord ? "My Contribution" : "Contribution"}
        </SectionLabel>
        <Badge tone={TIER_TONES[commitment.tier]}>
          {TIER_LABELS[commitment.tier]}
        </Badge>
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        {TIER_DESCRIPTIONS[commitment.tier]}
      </p>

      {/* Delivered leads, because it's the signal that matters most */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Deliverables done"
          value={delivered.deliverablesCompleted}
          hint={
            delivered.completionRate !== null
              ? `${formatPercent(delivered.completionRate)} of assigned`
              : "none assigned yet"
          }
        />
        <StatTile
          label="Projects completed"
          value={delivered.projectsCompleted}
          hint="carried to the finish"
        />
        <StatTile
          label="Hours / week"
          value={formatNumber(commitment.hoursPerWeek, 1)}
          hint={
            commitment.hoursToCore > 0
              ? `${formatNumber(commitment.hoursToCore, 1)} more to reach Core`
              : `at or above the ${WEEKLY_HOURS_EXPECTATION} hr target`
          }
        />
        <StatTile
          label="Updates on time"
          value={
            reliability.onTimeRate !== null
              ? formatPercent(reliability.onTimeRate)
              : "—"
          }
          hint={
            reliability.onTimeRate !== null
              ? `${reliability.late} late · ${reliability.missed} missed`
              : "nothing due yet"
          }
        />
      </div>

      {delivered.overdue > 0 ? (
        <p className="mt-4 text-sm font-medium text-cardinal-600">
          {delivered.overdue} deliverable
          {delivered.overdue === 1 ? " is" : "s are"} past due
          {isOwnRecord ? " — worth flagging to your RE if you're stuck." : "."}
        </p>
      ) : null}

      {/* Scope is reported, never blended into the other signals */}
      {scope.reRoleCount > 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          RE on {scope.reRoleCount} project
          {scope.reRoleCount === 1 ? "" : "s"} · committed to{" "}
          {scope.projectsCommitted}
        </p>
      ) : null}
    </div>
  );
}
