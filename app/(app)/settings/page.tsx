import { Info, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { PauseControls } from "@/components/forms/check-in-form";
import { ProfileForm } from "@/components/forms/profile-form";
import { AddTermForm, EditTermForm } from "@/components/forms/term-admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { UpdateScheduleForm } from "./update-schedule-form";
import { getSettings } from "@/lib/data/settings";
import { getViewer } from "@/lib/data/viewer";
import { TERM_KIND_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Settings · SkyRunners HQ",
};

/** "Sep 21 – Dec 4, 2026" — parsed as UTC so the day never shifts by timezone. */
function termRange(startsOn: string, endsOn: string): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    });
  return `${fmt(startsOn, false)} – ${fmt(endsOn, true)}`;
}

export default async function SettingsPage() {
  const viewer = await getViewer();
  const view = await getSettings(viewer.member.id);
  const { schedule, currentTerm, inSession, terms, calendarRunsOut } = view;

  const mayEdit = can.setOwnSchedule(viewer.actor, viewer.member.id);
  const mayEditCalendar = can.manageTerms(viewer.actor);
  const isPaused = !!schedule.pausedUntil;
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        label="My Settings"
        title="Update schedule"
        description="Choose the days you check in. Twice a week, on days that fit your schedule."
      />

      {/* Profile first: it's the thing a new member needs on day one. */}
      <Card>
        <CardBody>
          <SectionLabel>My Profile</SectionLabel>
          <h2 className="mt-2 text-2xl font-bold text-ink">Your details</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
            Everything here is optional except what you want people to see.
            Skills matter most — Find Work uses them to rank projects by where
            you&apos;d help.
          </p>
          <div className="mt-5">
            <ProfileForm member={viewer.member} />
          </div>
        </CardBody>
      </Card>

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
            when you come back. Give your Lead a heads-up too — pausing tells
            them you&apos;re busy, but a quick word tells them what to cover
            while you&apos;re out.
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

      {/* Academic calendar */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel>Academic Calendar</SectionLabel>
            {mayEditCalendar ? <AddTermForm /> : null}
          </div>

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
            /*
              Two different nothings, and they need different messages.
              An empty calendar is a club that hasn't been set up. A calendar
              that has RUN OUT is the quiet failure: somebody entered the year
              in September, it expired in June, and from then on no check-in is
              ever due again and the app just looks broken.
            */
            <p className="mt-3 flex items-start gap-2 text-[15px] text-warn-fg">
              <TriangleAlert className="mt-1 size-4 shrink-0" />
              <span>
                {calendarRunsOut
                  ? "The calendar has run out — the last period ended before today, so no check-ins are being generated for anyone."
                  : "No period covers today, so no check-ins are being generated."}{" "}
                {mayEditCalendar
                  ? "Add the quarters, finals weeks and breaks below."
                  : "A Co-Lead needs to add the academic calendar."}
              </span>
            </p>
          )}

          {terms.length > 0 ? (
            <div className="mt-5 space-y-2.5">
              {terms.map((term) => {
                const isNow =
                  term.startsOn <= todayIso && todayIso <= term.endsOn;
                const isPast = term.endsOn < todayIso;

                return (
                  <div
                    key={term.id}
                    className={`rounded-tile border px-4 py-3 ${
                      isNow ? "border-cardinal-600" : "border-line"
                    } ${isPast ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[15px] font-bold text-ink">
                            {term.name}
                          </span>
                          <Badge tone="neutral">
                            {TERM_KIND_LABELS[term.kind]}
                          </Badge>
                          {isNow ? <Badge tone="cardinal">Now</Badge> : null}
                          {term.generatesObligations ? (
                            <Badge tone="ok">Check-ins run</Badge>
                          ) : (
                            <Badge tone="neutral">Paused</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-ink-muted">
                          {termRange(term.startsOn, term.endsOn)}
                        </p>
                      </div>
                      {mayEditCalendar ? <EditTermForm term={term} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {mayEditCalendar ? (
            <p className="mt-4 text-sm text-ink-muted">
              This table is what stops finals week generating a wall of missed
              check-ins for everyone. Keep it a year ahead.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
