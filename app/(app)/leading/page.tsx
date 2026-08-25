import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Minus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { GuideBlocks } from "@/components/ui/guide-blocks";
import { getGuideSections } from "@/lib/data/guides";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { getViewer } from "@/lib/data/viewer";
import { getLeadershipRoles } from "@/lib/data/members";
import { can, isCoLead, isLeadership } from "@/lib/permissions";
import { HELP_REQUEST_STALE_DAYS } from "@/lib/types";

export const metadata = {
  title: "Leading here",
};

/**
 * What a Lead, a PL and a Co-Lead can and cannot do.
 *
 * ---------------------------------------------------------------------------
 * Why this page exists
 * ---------------------------------------------------------------------------
 *
 * `lib/permissions.ts` is 900 lines and correct. Nobody in the club will read
 * it, and the app's authority model has one genuinely counter-intuitive shape
 * at its centre: **being somebody's Lead and being a PL of their project are
 * different jobs, held by different people, and neither implies the other.**
 * Everything confusing downstream — why a PL can't open a report, why a Lead
 * can't sign off a deliverable, why completing a project needs somebody else —
 * follows from that one split.
 *
 * A Lead who doesn't know it either over-reaches (and finds a button missing,
 * and assumes the app is broken) or under-reaches (and leaves work stuck
 * because they assumed it wasn't theirs).
 *
 * Written as CAN and CANNOT, because the cannots are the half people get
 * wrong, and stating them as deliberate choices with reasons is what stops
 * them being read as gaps to work around.
 *
 * Open to anybody holding authority of any kind, INCLUDING a plain member who
 * is a PL — see the note in the body. Redirected rather than hidden for the
 * few who hold none: hiding a link is not access control, same rule as
 * `/dashboard`.
 */
export default async function LeadingPage() {
  const viewer = await getViewer();
  const guideSections = await getGuideSections("leading");
  const mayEditGuides = can.manageGuides(viewer.actor);
  const role = await getLeadershipRoles(viewer.member.id);

  /*
    Deliberately NOT gated on `globalRole`.

    A PL is very often a plain member — that's the point of the role, and
    `can.createEvent` and the join-request flow both lean on it. Gating this
    page on being a Lead would lock out exactly the people most likely to be
    surprised by what a PL can and can't do.

    Nothing here is sensitive either; it's the same rules published at
    /how-we-lead in less detail. So the only people sent away are those holding
    no authority at all, for whom it would read as a page about how they're
    watched.
  */
  const holdsSomething =
    isLeadership(viewer.actor) || role.isRE || role.divisionsLed.length > 0;
  if (!holdsSomething) redirect("/how-we-lead");

  const coLead = isCoLead(viewer.actor);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Leading Here"
        title={
          coLead
            ? "What a Co-Lead does"
            : role.divisionsLed.length > 0
              ? "What a Division Lead does"
              : viewer.member.globalRole === "lead"
                ? "What a Lead does"
                : "What a PL does"
        }
        description="Who can do what, and why the limits are deliberate. Members see all of this at /how-we-lead."
      />

      {/* ------------------------------------------------------------------
          The one idea everything else follows from.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>Read this first</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Authority comes from the project, not from your title
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-tile border-line border px-4 py-3.5">
              <Badge tone="cardinal">PL</Badge>
              <p className="text-ink mt-2 text-sm font-bold">
                You look after a PROJECT
              </p>
              <p className="text-ink-soft mt-1 text-sm">
                You&apos;re accountable for one project&apos;s deliverables. You
                decide who joins, you sign work off, you read its feed and
                answer what people write in it. Authority flows{" "}
                <span className="text-ink font-semibold">down</span> the project
                tree — a PL of a parent covers everything beneath it, however
                deep.
              </p>
            </div>
            <div className="rounded-tile border-line border px-4 py-3.5">
              <Badge tone="neutral">Team Lead</Badge>
              <p className="text-ink mt-2 text-sm font-bold">
                A title, plus whatever you&apos;re PL of
              </p>
              <p className="text-ink-soft mt-1 text-sm">
                Being a Team Lead makes you findable — people know to ask you
                about your area. It does not, by itself, give you authority over
                anybody. If you lead a{" "}
                <span className="text-ink font-semibold">division</span>,
                that&apos;s different: it makes you a top PL over every project
                inside it.
              </p>
            </div>
          </div>

          <div className="rounded-tile bg-surface mt-4 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                Nobody reports to anybody, as of 2026-08-24.
              </span>{" "}
              There used to be a second hierarchy here: every member had a named
              Lead who read their twice-weekly check-in. The club removed it.
              Members report to their PLs now, through the work they log on a
              project — which is public, sits in that project&apos;s feed, and
              can be replied to in place.
            </p>
            <p className="text-ink-soft mt-2 text-sm">
              What that means for you in practice: if you want to know how
              somebody is doing, open the project you share with them. If you
              want somebody to be accountable for a piece of work, make them its
              PL. There is no longer any other lever.
            </p>
          </div>

          <p className="text-ink-soft mt-4 text-[15px]">
            <span className="text-ink font-semibold">
              A Division Lead is a top PL.
            </span>{" "}
            Leading a division gives you PL powers over every project inside it,
            at any depth — deliverables, sign-off, join requests, appointing PLs
            — without being named on each one. Leading a sub-team gives you the
            same over that team&apos;s work and nothing sideways. This is the
            one place a title still carries authority, and it is authority over
            WORK.
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          PL. Spelled out because the role is held by plain members, carries
          real authority, and nothing about a member's badge says they have it.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>If you&apos;re a PL</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            You are accountable for one project finishing
            {role.isRE ? null : (
              <span className="text-ink-muted text-base font-normal">
                {" "}
                — you aren&apos;t one right now
              </span>
            )}
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            Not a rank. You can be a first-year member and a PL, and plenty are.
            Authority runs <span className="text-ink font-semibold">down</span>{" "}
            the project tree: a PL of a parent project can do all of this on
            everything beneath it, at any depth, which is what makes escalation
            work.
          </p>

          <div className="mt-4 space-y-2.5">
            <Rule can title="Decide who works on it">
              Add people, approve join requests, appoint other PLs. Members
              can&apos;t add themselves — you decide, because you carry the
              deliverable.
            </Rule>
            <Rule can title="Shape the deliverables">
              One flat list: title, one owner, one date. Five minutes a week of
              upkeep is what buys everything else — real progress bars,
              trustworthy &ldquo;projects completed&rdquo;, and an honest
              timeline.
            </Rule>
            <Rule can title="Keep the checklist under a deliverable">
              Small things that have to happen but aren&apos;t worth their own
              deliverable — move the jig back to the robotics room, book the
              mill, chase the order. Add, tick, rename or delete them, and{" "}
              <span className="text-ink font-semibold">
                so can the deliverable&apos;s owner
              </span>
              . That&apos;s the one place in the app where the person doing the
              work has a right their PL-only neighbours don&apos;t, and
              it&apos;s deliberate: they&apos;re the one who finds out what the
              job actually involves.
            </Rule>
            <Rule can title="Sign work off, or send it back">
              The owner claims done; you agree or you don&apos;t. Send-backs
              need a reason — a bare rejection is what stops people submitting.
            </Rule>
            <Rule title="Sign off while a checklist item is still open">
              Neither can the owner. The list says the work isn&apos;t finished,
              so the app takes it at its word. Clear it yourself — tick the
              items, or delete the ones that turned out not to be needed.
              Deleting is fine: a todo counts towards nothing.
            </Rule>
            <Rule title="Give a checklist item an owner or a due date">
              Deliberately nowhere to put them. If something needs a name and a
              date against it, it isn&apos;t a checklist item — it&apos;s a
              deliverable. Errands filed as deliverables are what makes
              &ldquo;projects completed&rdquo; stop meaning anything: ten of
              them and somebody outranks the person who shipped the airframe.
            </Rule>
            <Rule can title="Answer what people wrote about your project">
              Everything logged on your project is public and you can reply to
              any line of it, in place. This is the whole reporting relationship
              now, so it is worth actually doing: a reply is what tells somebody
              their note was read.
            </Rule>
            <Rule title="Declare your own project finished">
              The PL above you, or the Division Lead, agrees it&apos;s done. Set
              the stage to flight test and tell them it&apos;s ready.
            </Rule>
            <Rule title="Leave a parent project as its last PL">
              Everything underneath escalates through it, so name somebody else
              first. The same applies if you&apos;re stepping back for a quarter
              — hand it over rather than going quiet, because a project with an
              absent sole PL blocks every sign-off beneath it.
            </Rule>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          Advisors. Here rather than in the member guide because the people who
          need to understand the role are the ones who work alongside one — an
          PL wondering why a professor can comment but not sign anything off.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>Working with an advisor</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            They see everything and run nothing
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            A faculty or project advisor. They can read every project, work-log
            entry and ask on the board, comment on any of it, and turn up to any
            session. They hold no authority at all — that&apos;s the point, not
            a gap.
          </p>

          <div className="mt-4 space-y-2.5">
            <Rule can title="Name one on your project">
              Any PL can, from{" "}
              <span className="text-ink font-semibold">Who to ask</span>. It
              grants them nothing — they could already see your project, and
              every other one. All it changes is whether your project tells
              people they&apos;re available.
            </Rule>
            <Rule can title="Ask them anything, in the open">
              Their answer lands on the project where the next person with the
              same problem will find it, rather than in a DM only you can read.
            </Rule>
            <Rule title="Give an advisor a deliverable">
              There&apos;s nowhere to. They own no work and log nothing, so they
              appear in no staffing count. A project with two engineers and a
              professor is a project with two engineers.
            </Rule>
            <Rule title="Expect them to sign anything off">
              Approving work is a PL&apos;s job and stays one. An advisor saying
              the analysis looks wrong is exactly what they&apos;re for; acting
              on it is still yours.
            </Rule>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          Division Lead — both hierarchies at once, which surprises people.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>If you lead a division</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            You&apos;re a top PL over everything inside it
            {role.divisionsLed.length > 0 ? (
              <span className="text-ink-muted text-base font-normal">
                {" "}
                — {role.divisionsLed.join(", ")}
              </span>
            ) : null}
          </h2>
          <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
            This is the one that surprises people. Leading a division gives you
            everything in the PL list above on{" "}
            <span className="text-ink font-semibold">
              every project inside it
            </span>
            , at any depth — including sub-projects that were never explicitly
            assigned to your division, because they inherit it from their
            parent. You don&apos;t have to be named on a project to act on it.
          </p>

          <div className="mt-4 space-y-2.5">
            <Rule can title="Approve completion inside your division">
              You&apos;re the reviewer of record for work whose PL can&apos;t
              sign off their own project. In practice that&apos;s most top-level
              projects.
            </Rule>
            <Rule can title="Start projects in your division">
              And in sub-teams beneath it. Not in somebody else&apos;s division
              — nothing here grants anything sideways.
            </Rule>
            <Rule can title="Take the completion notice">
              When a project finishes, the announcement goes up the project tree
              and stops with you. Co-Leads aren&apos;t pinged for every finished
              project; they&apos;re managers, not the queue.
            </Rule>
            <Rule title="Read personal reports across your division">
              Still no. Leading a division is project authority, not people
              authority — unless you&apos;re also in that member&apos;s Lead
              chain. The two hierarchies stay separate all the way up.
            </Rule>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          The obligations. Short, because there are only two.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>What you owe</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            About fifteen minutes a week
          </h2>

          <div className="mt-4 space-y-2.5">
            <Rule can title="Read the feed on projects you're a PL of">
              Work people log lands in the project&apos;s feed, and you can
              reply to any line of it. That is the whole reporting relationship
              now — there are no check-ins to collect and nobody files a report
              to a person.
            </Rule>
            <Rule can title="Answer join requests on projects you're a PL of">
              Somebody asking to help is the whole point of Find Work.
              Unanswered requests escalate after {HELP_REQUEST_STALE_DAYS} days.
            </Rule>
            <Rule can title="Sign off finished deliverables">
              The owner claims it&apos;s done; you agree. Only your agreement
              makes it count, which is why the record is worth anything.
            </Rule>
          </div>

          <p className="text-ink-muted mt-4 text-sm">
            That&apos;s the job. Everything else on the dashboard is
            information, not an obligation.
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          The cannots. The half people get wrong.
      ------------------------------------------------------------------- */}
      <Card>
        <CardBody>
          <SectionLabel>What you deliberately can&apos;t do</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            These are choices, not gaps
          </h2>

          <div className="mt-4 space-y-2.5">
            <Rule title="Read somebody's old check-ins">
              A member&apos;s archived check-ins are theirs and a
              Co-Lead&apos;s. They carried a general note that was written when
              only the member&apos;s Lead was going to read it, so publishing
              them now would break a promise about words already typed.
              Everything else about a member is public, including what they
              logged on every project.
            </Rule>
            <Rule title="Mark a project complete when you're its PL">
              Finishing the work and agreeing it&apos;s finished are different
              jobs. The PL above the project — or its Division Lead — signs it
              off. You can change everything else about it, and you can always
              reopen it: saying something isn&apos;t done is always safe.
            </Rule>
            <Rule title="Overturn a sign-off on your own project">
              Same reason. Saying a signed-off deliverable was wrong comes from
              above the person who signed it, or it&apos;s the same signature
              marking its own homework.
            </Rule>
            <Rule title="Add yourself to a project">
              Nobody can. Ask the PL — it&apos;s tracked, and it escalates.
            </Rule>
            {!coLead ? (
              <Rule title="Start a project in a division you don't lead">
                Work appearing in a division whose lead didn&apos;t know about
                it is the silo problem wearing a different hat. You can create
                freely inside your own, and sub-projects under anything
                you&apos;re a PL of.
              </Rule>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------
          Co-Lead extras.
      ------------------------------------------------------------------- */}
      {coLead ? (
        <Card>
          <CardBody>
            <SectionLabel>Co-Lead only</SectionLabel>
            <h2 className="text-ink mt-2 text-2xl font-bold">
              The things that reshape the club
            </h2>
            <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
              A Co-Lead can do anything a Lead or a PL can, anywhere. On top of
              that, these are yours alone — they change the rules rather than
              the work, which is why they sit with the smallest group.
            </p>

            <div className="mt-4 space-y-2.5">
              <Rule can title="Divisions and sub-teams">
                Create, rename, appoint leads, and archive. Archiving is refused
                while live work sits inside — completed projects come along,
                because they&apos;re the history.
              </Rule>
              <Rule can title="The academic calendar">
                Terms drive what the app calls in-session, which is what dates
                on the calendar are shown against.{" "}
                <span className="text-ink font-semibold">
                  It used to also decide whether check-ins generated at all
                </span>{" "}
                — that was the one setup step with no other symptom, and it
                stops mattering now that nobody is asked for one.
              </Rule>
              <Rule can title="The trainings catalogue">
                Sites and machines are data, not code — add one and it appears
                for everyone with no deploy. Each one is either assigned to a
                named person who signs it off, or marked self-verify so members
                tick it themselves. Somebody who still verifies a machine
                can&apos;t be demoted or deactivated until it&apos;s reassigned.
              </Rule>
              <Rule can title="Roles, and deleting a broken profile">
                You can&apos;t change your own role, and the last Co-Lead
                can&apos;t be demoted or deactivated — both are lock-out guards.
                Deleting is for a duplicate profile that can never be signed
                into; use Deactivate for somebody leaving, which keeps their
                history.
              </Rule>
              <Rule can title="Invite members">
                Leads can invite too, so you don&apos;t have to be the
                bottleneck on getting people in.
              </Rule>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <SectionLabel>If you remember one thing</SectionLabel>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Read the feed on your projects and act on anything that says
            somebody is stuck. That single habit is most of the value here — the
            club loses members to being quietly blocked for three weeks, not to
            a lack of reporting.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-tile bg-cardinal-600 hover:bg-cardinal-700 inline-flex items-center gap-2 px-4 py-2.5 text-[15px] font-semibold text-white transition-colors"
            >
              Go to your dashboard
            </Link>
            <Link
              href="/how-we-lead"
              className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-2 border px-4 py-2.5 text-[15px] font-semibold transition-colors"
            >
              What members are told
            </Link>
          </div>
        </CardBody>
      </Card>

      {/*
        What the CLUB expects of a Lead, as opposed to what the app permits.

        Everything above is the permission model — what the code will and won't
        let you do. This is the other half: chasing people who stop logging
        their work, running a design review, handing a project over cleanly. None of
        that is enforceable in software and all of it changes term to term,
        which is exactly why it's editable at /settings/guides rather than
        hard-coded here.
      */}
      <GuideBlocks sections={guideSections} canEdit={mayEditGuides} />
    </div>
  );
}

/** A can / can't line. The icon carries the polarity so the text doesn't. */
function Rule({
  title,
  can = false,
  children,
}: {
  title: string;
  can?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-tile border-line flex gap-3 border px-4 py-3.5">
      <span
        className={`mt-0.5 shrink-0 ${can ? "text-ok-fg" : "text-ink-muted"}`}
      >
        {can ? (
          <Check className="size-4" strokeWidth={3} />
        ) : (
          <Minus className="size-4" strokeWidth={3} />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-ink text-sm font-bold">{title}</p>
        <p className="text-ink-soft mt-1 text-sm">{children}</p>
      </div>
    </div>
  );
}
