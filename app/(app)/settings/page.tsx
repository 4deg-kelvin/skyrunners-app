import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { PauseControls } from "@/components/forms/check-in-form";
import { ProfileForm } from "@/components/forms/profile-form";
import { McpTokens } from "@/components/forms/mcp-tokens";
import { CalendarFeed } from "@/components/forms/calendar-feed";
import { DigestToggle } from "@/components/forms/digest-toggle";
import { AddTermForm, EditTermForm } from "@/components/forms/term-admin";
import { ClubIdentityForm } from "@/components/forms/club-identity";
import { ThemeToggle } from "@/components/forms/theme-toggle";
import { discordIsConfigured } from "@/lib/notify/discord";
import { listMyTokens } from "@/lib/mcp/store";
import { myFeed } from "@/lib/calendar/store";
import { appUrl } from "@/lib/urls";
import {
  AddCatalogueItemForm,
  AddSectionForm,
  EditCatalogueItemForm,
} from "@/components/forms/training-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { UpdateScheduleForm } from "./update-schedule-form";
import { getClubIdentity, getSettings } from "@/lib/data/settings";
import { getCatalogue } from "@/lib/data/trainings";
import { getLeadershipRoles } from "@/lib/data/members";
import { getViewer } from "@/lib/data/viewer";
import { getThemeChoice } from "@/lib/theme";
import { CATALOGUE_KIND_LABELS, TERM_KIND_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import type { CalendarClient } from "@/lib/calendar/feed-token";
import { formatDay, todayInClubTime } from "@/lib/dates";

export const metadata = {
  title: "Settings",
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
  const theme = await getThemeChoice();
  const [view, catalogue, identity, mcpTokens, calendarFeed] =
    await Promise.all([
      getSettings(viewer.member.id),
      getCatalogue(),
      getClubIdentity(),
      listMyTokens(),
      myFeed(),
    ]);

  /*
    Which calendar apps have actually collected the feed.

    From the member row, not from the feed: the credential is owner-only by RLS
    while the observation is public, so they live in different tables. See
    migration 0041. Narrowed here rather than cast, because these strings come
    from parsing a User-Agent and an old row could hold a value this build no
    longer produces — which would render as `undefined` in the badge.
  */
  const calendarClients = (viewer.member.calendarClients ?? []).filter(
    (c): c is CalendarClient =>
      c === "apple" || c === "google" || c === "outlook" || c === "other"
  );
  const { schedule, currentTerm, inSession, terms, calendarRunsOut } = view;

  /*
    Why this person would get a digest — used both to decide whether to show
    the toggle at all and to say, in the toggle's own words, what they'd be
    turning off. `getLeadershipRoles` is the same helper the profile page uses,
    so the count can't drift from what's shown elsewhere.
  */
  const roles = await getLeadershipRoles(viewer.member.id);
  const digestReasons = [
    roles.isRE ? "an RE" : "",
    roles.divisionsLed.length
      ? `Division Lead for ${roles.divisionsLed.join(" and ")}`
      : "",
    roles.hasReports ? "a Lead with reports" : "",
  ].filter(Boolean);

  const mayEdit = can.setOwnSchedule(viewer.actor, viewer.member.id);
  const mayEditCalendar = can.manageTerms(viewer.actor);
  const mayEditCatalogue = can.manageTrainingCatalogue(viewer.actor);
  const mayEditTiers = can.manageEngagementWeights(viewer.actor);
  const isPaused = !!schedule.pausedUntil;
  const todayIso = todayInClubTime();

  return (
    <div className="space-y-6">
      <PageHeader
        label="My Settings"
        title="Settings"
        /*
          The page grew well past its original job.

          It was called "Update schedule" when that's all it held. It now
          carries the profile, check-in days, the academic pause, and — for
          Co-Leads — the club's name, the commitment expectations, the academic
          calendar and the trainings catalogue. A menu item saying "Update
          schedule" hides all of that behind a name for one of its sections,
          so somebody looking for their phone number never opens it.
        */
        description="Your profile, the days you check in, and pausing for academics. Co-Leads also set the club's expectations, academic calendar and trainings catalogue here."
      />

      {/* Profile first: it's the thing a new member needs on day one. */}
      <Card>
        <CardBody>
          <SectionLabel>My Profile</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">Your details</h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Everything here is optional except what you want people to see.
            Skills matter most — Projects uses them to rank work by where
            you&apos;d help.
          </p>
          <div className="mt-5">
            <ProfileForm
              member={viewer.member}
              botLive={discordIsConfigured()}
              inviteUrl={identity.discordInviteUrl}
              // No Supabase in demo mode means no bucket to upload into.
              canUpload={!viewer.isDemo}
            />
          </div>
        </CardBody>
      </Card>

      {/*
        Above "Connect your AI", and that ordering is deliberate.

        This is the one integration nearly every member should do, it takes one
        tap, and it pays off without them ever opening this site again — which is
        the whole adoption problem the calendar had. Connecting an AI is powerful
        and interesting and will be relevant to a handful of people.
      */}
      <Card>
        <CardBody>
          <SectionLabel>Your calendar</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Club events, in your own calendar
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Subscribe once and every session you&apos;re on shows up in Apple
            Calendar, Google Calendar or Outlook — and keeps itself up to date
            when a time moves or something is cancelled. Nothing to install, and
            it works on your phone.
          </p>
          <div className="mt-5">
            <CalendarFeed
              feed={calendarFeed}
              clients={calendarClients}
              syncedAt={viewer.member.calendarSyncedAt}
              canUse={!viewer.isDemo}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>Connect your AI</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Use the club from Claude
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Point an AI assistant at SkyRunners and it can catch you up, find
            what&apos;s blocked, and — with a write token — assign deliverables
            and move projects along. It acts as you, with exactly your
            permissions.
          </p>
          <div className="mt-5">
            <McpTokens
              tokens={mcpTokens}
              serverUrl={appUrl("/api/mcp")}
              canUse={!viewer.isDemo}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>Check-in Days</SectionLabel>
              <h2 className="text-ink mt-2 text-2xl font-bold">Twice a week</h2>
              <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
                Two short check-ins beat one long one — they give you and your
                Lead something concrete to talk about twice as often, which is
                the whole point. Each one is pre-filled from your work log, so
                the only box you have to write yourself is for a project you
                logged nothing against.
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
            <p className="text-ink-muted mt-4 text-sm">
              Your schedule is paused until{" "}
              {formatDay(schedule.pausedUntil!, {
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
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Heads-down on classes?
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Pause your check-ins for a couple of weeks. Nothing counts against
            you, no reminder emails go out, and there&apos;s no backlog waiting
            when you come back. Give your Lead a heads-up too — pausing tells
            them you&apos;re busy, but a quick word tells them what to cover
            while you&apos;re out.
          </p>

          <div className="rounded-tile bg-surface mt-5 px-4 py-3.5">
            <p className="text-ink-soft flex items-start gap-2 text-sm">
              <Info className="text-ink-muted mt-0.5 size-4 shrink-0" />
              <span>
                Please use this instead of going quiet. Midterms happen to
                everyone, and we would much rather you pause for two weeks than
                feel behind and drift away. Your Lead sees that you&apos;re
                paused, not that you&apos;re missing.
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

      {/*
        The way into the guide editor.

        A link rather than the editor itself: this page already carries the
        profile, check-in days, the pause, the AI connection, the
        academic calendar and the trainings catalogue. A two-page content
        editor inline would bury everything a plain member came here for.
      */}
      {can.manageGuides(viewer.actor) ? (
        <Card>
          <CardBody>
            <SectionLabel>Co-Lead</SectionLabel>
            <h2 className="text-ink mt-2 text-2xl font-bold">
              The guide pages
            </h2>
            <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
              Add the club&apos;s own material to <em>New here?</em> and the
              Lead guide — how to set up Fusion or KiCad, shop rules, templates,
              anything you want a new member to have. Links to Google Docs work
              well.
            </p>
            <Link
              href="/settings/guides"
              className="rounded-tile border-line hover:bg-surface text-ink mt-4 inline-flex items-center gap-2 border px-4 py-2.5 text-[15px] font-semibold transition-colors"
            >
              Edit the guides →
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {/*
        Only for people who'd actually receive one. A toggle for a message a
        plain member never gets is a setting that does nothing.
      */}
      {digestReasons.length > 0 ? (
        <Card>
          <CardBody>
            <SectionLabel>Daily Digest</SectionLabel>
            <h2 className="text-ink mt-2 text-2xl font-bold">
              One message each evening
            </h2>
            <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
              Because you hold responsibility for work or people, Discord sends
              you a summary each evening — what moved, what&apos;s gone quiet
              and for how long, and anything due inside a week.
            </p>
            <div className="mt-5">
              <DigestToggle
                optedOut={viewer.member.dailyDigestOptOut ?? false}
                reasons={digestReasons}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* The club's own name. Co-Lead only, like everything else that
          reshapes the org. */}
      {mayEditTiers ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionLabel>The Club</SectionLabel>
              <ClubIdentityForm
                name={identity.name}
                description={identity.description}
                discordInviteUrl={identity.discordInviteUrl}
              />
            </div>
            <h3 className="text-ink mt-3 text-[17px] font-bold">
              {identity.name}
            </h3>
            <p className="text-ink-soft mt-1 text-[15px]">
              {identity.description}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {/*
        A "Commitment Expectations" card stood here: the club's four tier floors
        in hours per week, visible to everyone and editable by Co-Leads through
        `TierAdminForm`.

        Both are gone (2026-08-14 — hours are not the measure; deliverables are).
        The card is NOT replaced by a card saying the same thing without numbers:
        the expectation the club actually publishes now lives at /how-we-lead in
        prose, and duplicating it into a settings panel is how the two drift.

        `can.manageEngagementWeights` still exists and still gates the academic
        calendar and the catalogue above. It is not dead.
      */}

      {/*
        Discord used to have its own card here, holding the status and the test
        button while the ID itself lived on the profile form above. Two places
        for one value, and the commonest question it produced — "I pasted my
        ID, why does it still say I'm not connected?" — was answered two inches
        further down the page, where nobody looked. Badge and button now sit on
        the field. See `DiscordIdField`.
      */}
      {/*
        Appearance. Near the top because it's the only setting on this page a
        member is likely to come looking for on purpose, rather than one they
        set once and forget.
      */}
      <Card>
        <CardBody>
          <SectionLabel>Appearance</SectionLabel>
          <h3 className="text-ink mt-2 text-[17px] font-bold">Light or dark</h3>
          <p className="text-ink-soft mt-1 mb-4 text-[15px]">
            Dark mode for late nights in the lab. It applies the moment you
            switch, on every page.
          </p>
          <ThemeToggle theme={theme} />
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
                <h3 className="text-ink text-[17px] font-bold">
                  {currentTerm.name}
                </h3>
                <Badge tone={inSession ? "ok" : "neutral"}>
                  {inSession ? "In session" : "No check-ins due"}
                </Badge>
              </div>
              <p className="text-ink-soft mt-2 text-[15px]">
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
            <p className="text-warn-fg mt-3 flex items-start gap-2 text-[15px]">
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
                          <span className="text-ink text-[15px] font-bold">
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
                        <p className="text-ink-muted mt-1 text-sm">
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
            <p className="text-ink-muted mt-4 text-sm">
              This table is what stops finals week generating a wall of missed
              check-ins for everyone. Keep it a year ahead.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/*
        The trainings catalogue — club-wide, so it lives here rather than on
        anybody's profile.

        This was on the member profile at first and read exactly as wrong as it
        was: a Lead verifying somebody's laser training could, from the same
        row, retire the laser for the whole club. Two different scopes. A
        person's record is on their profile; the shop's contents are here, next
        to the academic calendar, which is the other thing a Co-Lead configures
        once and rarely revisits.
      */}
      {mayEditCatalogue ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <SectionLabel>Trainings Catalogue</SectionLabel>
                <p className="text-ink-soft mt-2 text-[15px]">
                  Every site and machine the club is trained on. Adding one is
                  typing a name — it appears on everyone&apos;s profile straight
                  away, unearned.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <AddSectionForm />
                <AddCatalogueItemForm sections={catalogue.sectionOptions} />
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {catalogue.sections.map(({ section, items }) => (
                <div key={section.id}>
                  <p className="text-ink text-xs font-semibold tracking-wide uppercase">
                    {section.name}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-tile border-line border px-3 py-2 ${
                          item.isActive ? "" : "opacity-60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-ink text-sm font-semibold">
                              {item.name}
                            </span>
                            <Badge tone="neutral">
                              {CATALOGUE_KIND_LABELS[item.kind]}
                            </Badge>
                            {item.validityMonths ? (
                              <Badge tone="warn">
                                Expires after {item.validityMonths} months
                              </Badge>
                            ) : null}
                            {!item.isActive ? (
                              <Badge tone="neutral">Retired</Badge>
                            ) : null}
                          </span>
                          <EditCatalogueItemForm item={item} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-ink-muted mt-4 text-sm">
              Set an expiry only if the clearance really lapses. When one does,
              it&apos;s cancelled and the member&apos;s Lead is told — there is
              no grace period, because a lapsed clearance that still reads as
              valid is the failure that hurts somebody.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
