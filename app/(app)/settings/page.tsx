import { Info } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { PauseControls } from "@/components/forms/check-in-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { UpdateScheduleForm } from "./update-schedule-form";
import { getSettings } from "@/lib/data/settings";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Settings · SkyRunners HQ",
};

export default async function SettingsPage() {
  const viewer = await getViewer();
  const view = await getSettings(viewer.member.id);
  const { schedule, currentTerm, inSession } = view;

  const mayEdit = can.setOwnSchedule(viewer.actor, viewer.member.id);
  const isPaused = !!schedule.pausedUntil;

  return (
    <div className="space-y-6">
      <PageHeader
        label="My Settings"
        title="Update schedule"
        description="Choose the days you check in. Twice a week, on days that fit your schedule."
      />

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>Check-in Days</SectionLabel>
              <h2 className="mt-2 text-2xl font-bold text-ink">
                Twice a week
              </h2>
              <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
                Two short check-ins beat one long one — they give you and your Lead
                something concrete to talk about twice as often, which is the whole
                point. Each one is pre-filled from your logged hours and open
                deliverables, so it&apos;s usually a couple of sentences.
              </p>
            </div>
            {isPaused ? <Badge tone="neutral">Paused</Badge> : null}
          </div>

          <div className="mt-6">
            <UpdateScheduleForm
              updatesPerWeek={schedule.updatesPerWeek}
              initialWeekdays={schedule.weekdays}
              disabled={!mayEdit || isPaused}
            />
          </div>

          {isPaused ? (
            <p className="mt-4 text-sm text-ink-muted">
              Your schedule is paused until{" "}
              {new Date(schedule.pausedUntil!).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
              })}
              . Resume it below to change your days.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* Academic pause — the retention feature */}
      <Card>
        <CardBody>
          <SectionLabel>Academic Pause</SectionLabel>
          <h2 className="mt-2 text-2xl font-bold text-ink">
            Heads-down on classes?
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
            Pause your check-ins for a couple of weeks. Nothing counts against
            you, no reminder emails go out, and there&apos;s no backlog waiting
            when you come back.
          </p>

          <div className="mt-5 rounded-tile bg-surface px-4 py-3.5">
            <p className="flex items-start gap-2 text-sm text-ink-soft">
              <Info className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <span>
                Please use this instead of going quiet. Midterms happen to
                everyone, and we would much rather you pause for two weeks than
                feel behind and drift away. Your Lead sees that you&apos;re paused,
                not that you&apos;re missing.
              </span>
            </p>
          </div>

          {/*
            These were disabled placeholders for a long time, which was the
            right call while they did nothing: the copy above tells members to
            pause rather than go quiet, so a button that silently failed would
            have produced exactly the outcome the feature exists to prevent.

            They now write for real. Pausing also clears any open obligations,
            so nobody returns from midterms to a wall of missed check-ins.
          */}
          <div className="mt-5">
            <PauseControls pausedUntil={schedule.pausedUntil} />
          </div>
        </CardBody>
      </Card>

      {/* Academic calendar context */}
      <Card>
        <CardBody>
          <SectionLabel>Academic Calendar</SectionLabel>
          {currentTerm ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h3 className="text-[17px] font-bold text-ink">
                  {currentTerm.name}
                </h3>
                <Badge tone={inSession ? "ok" : "neutral"}>
                  {inSession ? "In session" : "No check-ins due"}
                </Badge>
              </div>
              <p className="mt-2 text-[15px] text-ink-soft">
                {inSession
                  ? "Check-ins are running normally this term."
                  : "Nothing is due right now — check-ins pause automatically over finals, breaks and summer. Nobody accrues missed updates while the club is out of session."}
              </p>
            </>
          ) : (
            <p className="mt-3 text-[15px] text-ink-soft">
              No term is set for today. A Co-Lead needs to add the academic
              calendar before check-ins start generating.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
