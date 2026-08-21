import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  HandHelping,
  HardHat,
  PenLine,
  MessagesSquare,
  Search,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { GuideBlocks } from "@/components/ui/guide-blocks";
import { getGuideSections } from "@/lib/data/guides";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { getClubIdentity } from "@/lib/data/settings";
import { getViewer } from "@/lib/data/viewer";
import { discordIsConfigured } from "@/lib/notify/discord";

export const metadata = {
  title: "New Member Resources",
};

/**
 * The one page that explains the app to somebody who has never seen it.
 *
 * ---------------------------------------------------------------------------
 * Why this exists and why it's in the account menu
 * ---------------------------------------------------------------------------
 *
 * Everything here is discoverable by clicking around, eventually. "Eventually"
 * is the problem: the club loses people to disorganisation, and a new member
 * who can't tell what the app wants from them in the first five minutes is
 * exactly the person who drifts.
 *
 * It is NOT a nav item. The nav has six and that ceiling is deliberate (see
 * CLAUDE.md) — this is read once or twice and then never again, which is the
 * definition of something that belongs behind a menu rather than in front of
 * everybody permanently.
 *
 * ---------------------------------------------------------------------------
 * The order is the argument
 * ---------------------------------------------------------------------------
 *
 * The work log and check-ins come first, ahead of even finding work, because
 * they're the two things the app asks a member to DO that nothing else in their
 * life has taught them. Everything after that is either self-evident (browse
 * projects) or only matters once they're on something.
 *
 * Written in second person and in the club's actual language — "RE", "Lead",
 * "deliverable" — with each term explained the first time. A glossary at the
 * bottom would mean reading the page twice.
 */
export default async function GettingStartedPage() {
  const viewer = await getViewer();
  const guideSections = await getGuideSections("getting_started");
  const mayEditGuides = can.manageGuides(viewer.actor);
  const identity = await getClubIdentity();
  const firstName =
    viewer.member.preferredName ?? viewer.member.fullName.split(" ")[0];
  /*
    "Done" means different things depending on whether the bot exists yet.

    With a bot, done = a message actually arrived. Without one there is nothing
    to verify against, so having pasted an ID IS the whole job — and telling
    somebody they aren't finished when there is no next step they can take is
    how a required section gets ignored.
  */
  const canVerify = discordIsConfigured();
  const connected = canVerify
    ? Boolean(viewer.member.discordVerifiedAt)
    : Boolean(viewer.member.discordUserId);

  return (
    <div className="space-y-6">
      <PageHeader
        label="New Member Resources"
        title={`Welcome, ${firstName}`}
        description="Five minutes, once. Only the first two sections are worth remembering — look the rest up when you need it."
      />

      {/*
        The club's own guides, FIRST.

        This sat last for a while, on the reasoning that everything below explains
        how the app works — the same for any club — while this is Stanford UAV's
        own material, which makes more sense once you know what you're being asked
        to do. Anish moved it to the top on 2026-08-16, and he is right about the
        audience: somebody opening this page has usually been handed a link and
        told to get set up, and the onboarding doc IS the thing they came for.
        Making them scroll past five sections of model explanation to reach it
        buries the one item with a deadline attached.

        Co-Leads edit it at /settings/guides; see migration 0038 for why only this
        half is data rather than code.
      */}
      <GuideBlocks sections={guideSections} canEdit={mayEditGuides} />

      {/* ------------------------------------------------------------------
          0. Discord. A setup chore, not a concept — which is why it sits
          ABOVE "first thing" without taking that label. The work log is still
          the first thing to understand; this is the two minutes of admin that
          has to happen before any of it can reach you.
      ------------------------------------------------------------------- */}
      {/* Anchor on a wrapper: `Card` takes no id, and adding one to a shared
          primitive for a single link target isn't worth widening its API. */}
      <div id="discord">
        <Card
          className={connected ? undefined : "border-warn-fg/40 bg-warn-bg/40"}
        >
          <CardBody>
            <SectionLabel>Required · two minutes</SectionLabel>
            <h2 className="text-ink mt-2 flex flex-wrap items-center gap-2.5 text-2xl font-bold">
              <MessagesSquare
                className="text-cardinal-600 size-6"
                strokeWidth={2.5}
              />
              Connect Discord
              {connected ? (
                <Badge tone="ok">Done</Badge>
              ) : (
                <Badge tone="warn">Not done</Badge>
              )}
            </h2>

            <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
              All club communication runs through Discord. The app messages you
              there when you&apos;re added to a project, when an ask of yours is
              answered, and — if you lead people — when one of them checks in.
              Nothing else, and never a group ping.
            </p>

            {connected ? (
              <p className="text-ok-fg mt-3 text-[15px] font-semibold">
                {canVerify
                  ? "You're connected. Nothing more to do here."
                  : "Your ID is saved — that's your part. The bot will reach you once the club switches it on."}
              </p>
            ) : (
              <ol className="mt-4 space-y-2.5">
                <Step n={1}>
                  <span className="text-ink font-semibold">
                    Install Discord and join the club server
                  </span>{" "}
                  if you haven&apos;t. The bot can&apos;t message somebody who
                  isn&apos;t in the server, so this step is not optional.
                  {/*
                    "Ask any Co-Lead for the invite link" was the instruction
                    here, which is the dead end this whole app exists to
                    remove: a required step whose only route is finding a
                    specific person. A Co-Lead pastes the link into Settings
                    once and it becomes a button. Absent, the old wording is
                    still the honest fallback rather than a broken link.
                  */}
                  {identity.discordInviteUrl ? (
                    <>
                      {" "}
                      <a
                        href={identity.discordInviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
                      >
                        Join the {identity.name} Discord →
                      </a>
                    </>
                  ) : (
                    " Ask any Co-Lead for the invite link."
                  )}
                </Step>
                <Step n={2}>
                  In Discord, turn on{" "}
                  <span className="text-ink font-semibold">
                    Settings → Advanced → Developer Mode
                  </span>
                  .
                </Step>
                <Step n={3}>
                  Right-click your own name anywhere and choose{" "}
                  <span className="text-ink font-semibold">Copy User ID</span>.
                  It&apos;s a long number — not your username.
                </Step>
                <Step n={4}>
                  Paste it into{" "}
                  <Link
                    href="/settings"
                    className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
                  >
                    Settings → My Profile
                  </Link>
                  {canVerify
                    ? " and save. A Verify now button appears beside the field — press it, and if the message arrives you get a Verified badge and this banner goes away."
                    : " That's it. The club's bot isn't switched on yet, so there's nothing to test against; it'll start reaching you once it is."}
                </Step>
              </ol>
            )}

            {connected ? null : (
              <div className="mt-4">
                <Link
                  href="/settings"
                  className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
                >
                  Go connect it
                </Link>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------------------------
          1. The work log. First because it's the smallest habit and the one the
          rest of the app is built on: the twice-weekly check-in drafts itself
          from these entries, so a member who logs as they go writes almost
          nothing later, and one who doesn't writes the whole thing by hand.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>First thing</SectionLabel>
          <h2 className="text-ink mt-2 flex items-center gap-2.5 text-2xl font-bold">
            <Clock className="text-cardinal-600 size-6" strokeWidth={2.5} />
            Log what you did, as you go
          </h2>

          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Every time you work on something for the club, log it on{" "}
            <Link
              href="/my-work"
              className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
            >
              My Work
            </Link>
            . Pick the project and write one line about what you did — there are
            no hours to fill in. It takes about ten seconds and you can backdate
            up to a week.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-tile border-line border px-4 py-3.5">
              <p className="text-ink text-sm font-bold">
                Helped on something you&apos;re not on?
              </p>
              <p className="text-ink-soft mt-1 text-sm">
                Log it as <span className="font-semibold">misc</span> — leave
                the project blank. You did the work; it counts.
              </p>
            </div>
            <div className="rounded-tile border-line border px-4 py-3.5">
              <p className="text-ink text-sm font-bold">Got it wrong?</p>
              <p className="text-ink-soft mt-1 text-sm">
                Recent entries are listed under the form and you can delete
                them, right up until a check-in has reported them.
              </p>
            </div>
          </div>

          <div className="rounded-tile bg-surface mt-4 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">Why it matters:</span>{" "}
              your check-in writes itself from these lines. Each project&apos;s
              box arrives already filled in from what you logged against it, and
              the only box you have to write is for a project you logged nothing
              against. So this isn&apos;t extra paperwork — it&apos;s the same
              writing, done in ten-second pieces while you still remember. The
              club does not count hours and nobody is ranked against anybody
              else.
            </p>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          2. Check-ins. The obligation people are most likely to
          misunderstand as a status report to management.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>Second thing</SectionLabel>
          <h2 className="text-ink mt-2 flex items-center gap-2.5 text-2xl font-bold">
            <PenLine className="text-cardinal-600 size-6" strokeWidth={2.5} />
            Write a check-in twice a week
          </h2>

          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Two short updates a week, on{" "}
            <Link
              href="/settings"
              className="text-cardinal-600 hover:text-cardinal-700 font-semibold"
            >
              days you choose
            </Link>
            . You get a box per project you&apos;re on, already written from
            your work log — edit what needs it and send. The only box you have
            to fill in yourself is for a project you logged nothing against, and
            &ldquo;blocked&rdquo; or &ldquo;no time this week&rdquo; is a real
            answer.
          </p>

          <div className="mt-4 space-y-2.5">
            <div className="rounded-tile border-line border px-4 py-3.5">
              <p className="text-ink text-sm font-bold">
                It&apos;s a conversation starter, not a report
              </p>
              <p className="text-ink-soft mt-1 text-sm">
                One named person — your Lead — reads it, so they know where to
                help before you have to ask. Nobody grades it.
              </p>
            </div>
            <div className="rounded-tile border-line border px-4 py-3.5">
              <p className="text-ink text-sm font-bold">
                The best check-in is often &ldquo;I&apos;m stuck&rdquo;
              </p>
              <p className="text-ink-soft mt-1 text-sm">
                You do not need to have made progress to write one. Blocked,
                waiting on a part, buried in midterms — that&apos;s the update
                worth reading, and it&apos;s the one that gets you unblocked.
              </p>
            </div>
            <div className="rounded-tile border-line border px-4 py-3.5">
              <p className="text-ink text-sm font-bold">Midterms? Pause it</p>
              <p className="text-ink-soft mt-1 text-sm">
                Set an academic pause in Settings. Nothing counts against you
                while it&apos;s on and there&apos;s no backlog waiting. We would
                much rather you pause than disappear.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          3. Everything else, in the order a new member hits it.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>Then, as you need it</SectionLabel>

          <div className="mt-4 space-y-5">
            <Guide
              icon={<Search className="size-5" strokeWidth={2.5} />}
              title="Finding something to work on"
              href="/find-work"
              linkLabel="Find Work"
            >
              Every project, sorted by where you&apos;d help most — unstaffed
              and stuck first. Nobody assigns you work: find something and press{" "}
              <span className="text-ink font-semibold">Ask to join</span>. The{" "}
              <span className="text-ink font-semibold">RE</span> (Responsible
              Engineer, accountable for that project) gets a tracked request,
              and it escalates on its own after five days.
            </Guide>

            <Guide
              icon={<Eye className="size-5" strokeWidth={2.5} />}
              title="Following vs joining"
              href="/projects"
              linkLabel="Projects"
            >
              <span className="text-ink font-semibold">Follow</span> anything,
              instantly, as many as you like — that&apos;s just watching.{" "}
              <span className="text-ink font-semibold">Joining</span> needs the
              RE to say yes, because they&apos;re accountable for the work. Same
              reason you can&apos;t add yourself.
            </Guide>

            <Guide
              icon={<ClipboardList className="size-5" strokeWidth={2.5} />}
              title="Deliverables — what you actually own"
              href="/my-work"
              linkLabel="My Work"
            >
              One piece of work, one owner, one date. Mark it done when you
              finish — that&apos;s a{" "}
              <span className="text-ink font-semibold">claim</span>. An RE signs
              it off, and only then does it count. Two steps so nobody marks
              their own homework.
            </Guide>

            <Guide
              icon={<CalendarDays className="size-5" strokeWidth={2.5} />}
              title="Turning up to things"
              href="/calendar"
              linkLabel="Calendar"
            >
              Sessions, meetings and deadlines in one list. Anything open you
              can turn up to, whether or not you&apos;re on the project — press{" "}
              <span className="text-ink font-semibold">I&apos;ll be there</span>
              . Put your own session up too; two people on the spar on a
              Thursday is what it&apos;s for.
            </Guide>

            <Guide
              icon={<HardHat className="size-5" strokeWidth={2.5} />}
              title="Getting into the labs"
              href={`/members/${viewer.member.id}`}
              linkLabel="your profile"
            >
              Rooms and machines live on your profile under Trainings — the
              robotics room, the laser cutter, the mill. Request one there and a
              Lead verifies it once you&apos;ve done the safety training.
              Everyone can see who&apos;s cleared, so you know who to ask.
            </Guide>

            {/*
              The two request routes, side by side and in this order.

              They look like the same thing and are not, and getting it wrong
              costs a member a day: asking a Lead for laser cutter access gets
              a "do the training first" they could have read here, and filing a
              training request for a Google Drive goes into a queue that expects
              a safety sign-off nobody is going to give.

              The rule in one line: **needs training -> Trainings; needs
              somebody to say yes -> ask a person.**
            */}
            <Guide
              icon={<HandHelping className="size-5" strokeWidth={2.5} />}
              title="Asking for anything else"
              href="/members"
              linkLabel="the roster"
            >
              Software and accounts need no safety check, so they skip Trainings
              — the{" "}
              <span className="text-ink font-semibold">Fusion team drive</span>,
              an Onshape seat, the GitHub org, a key to the parts cabinet. Open
              the profile of the Lead who looks after it and press{" "}
              <span className="text-ink font-semibold">
                Ask &lt;name&gt; for something
              </span>
              , saying what it&apos;s for in one line.
              <br />
              <br />
              It lands on their dashboard with their other requests, and you get
              a Discord message when they reply. Don&apos;t know who to ask? Any
              Co-Lead can answer anything.
            </Guide>

            <Guide
              icon={<CheckCircle2 className="size-5" strokeWidth={2.5} />}
              title="What other people can see"
              href="/how-we-lead"
              linkLabel="How we work"
            >
              Your projects, what you own, and what you wrote about each project
              are <span className="text-ink font-semibold">public</span> —
              that&apos;s the project&apos;s history, and how somebody spots a
              blocker they could clear. Your{" "}
              <span className="text-ink font-semibold">reliability</span> and
              personal record stay between you and your Lead. The rubric itself
              is published in full.
            </Guide>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>The short version</SectionLabel>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Log a line about what you did. Check in twice a week — mostly just
            confirming what the log already says. Ask to join anything that
            looks interesting. Say when you&apos;re stuck, early. That&apos;s
            the whole thing: about fifteen minutes a week.
          </p>
          <p className="text-ink-muted mt-3 text-sm">
            Your profile shows deliverables finished, check-ins on time, and the
            roles you hold. No hours, no tier, no score. Nobody is ranked
            against anybody else, and there is no leaderboard anywhere in this
            app.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/find-work"
              className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
            >
              Find something to work on
            </Link>
            <Link
              href="/how-we-lead"
              className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-2 border px-4 py-2.5 text-[15px] font-semibold transition-colors"
            >
              Read the full expectations
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** One "here's a thing the app does" block. */
function Guide({
  icon,
  title,
  href,
  linkLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <span className="text-cardinal-600 mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <h3 className="text-ink text-[17px] font-bold">{title}</h3>
        <p className="text-ink-soft mt-1 max-w-2xl text-[15px]">{children}</p>
        <Link
          href={href}
          className="text-cardinal-600 hover:text-cardinal-700 mt-1.5 inline-block text-sm font-semibold"
        >
          Go to {linkLabel} →
        </Link>
      </div>
    </div>
  );
}

/** One numbered setup step. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-cardinal-600 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
        {n}
      </span>
      <span className="text-ink-soft min-w-0 text-[15px]">{children}</span>
    </li>
  );
}
