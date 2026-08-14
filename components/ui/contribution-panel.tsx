import { SectionLabel } from "./section-label";
import { StatTile } from "./stat-tile";
import { type ContributionRecord } from "@/lib/contribution";
import { formatPercent } from "@/lib/utils";

/**
 * The contribution record, as three separate signals.
 *
 * There is no composite number here on purpose. A single score invites
 * optimization; a few honest columns invite judgment. Delivered comes first
 * because finished work is the only signal that can't be inflated.
 *
 * ---------------------------------------------------------------------------
 * There was a fourth tile, and a tier badge above it
 * ---------------------------------------------------------------------------
 *
 * "Hours / week", with a Core / Committed / Contributing badge and a "2.4 more
 * to reach Contributing" hint. All of it went on 2026-08-14 when the club
 * decided deliverables are the measure — see `lib/contribution.ts`.
 *
 * Three tiles, not four, and nothing was promoted to fill the gap. The grid is
 * `lg:grid-cols-3` now rather than 4: stretching three tiles across a
 * four-column layout leaves a hole where the hours used to be, which invites the
 * next person to fill it.
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
  const { delivered, reliability, scope } = record;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>
          {isOwnRecord ? "My Contribution" : "Contribution"}
        </SectionLabel>
      </div>

      {/* Delivered leads, because it's the signal that matters most */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <p className="text-cardinal-600 mt-4 text-sm font-medium">
          {delivered.overdue} deliverable
          {delivered.overdue === 1 ? " is" : "s are"} past due
          {isOwnRecord ? " — worth flagging to your RE if you're stuck." : "."}
        </p>
      ) : null}

      {/* Scope is reported, never blended into the other signals */}
      {scope.reRoleCount > 0 ? (
        <p className="text-ink-muted mt-4 text-sm">
          RE on {scope.reRoleCount} project
          {scope.reRoleCount === 1 ? "" : "s"} · committed to{" "}
          {scope.projectsCommitted}
        </p>
      ) : null}
    </div>
  );
}
