import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { LEADERSHIP_RUBRIC } from "@/lib/rubric";

/**
 * The published expectations and leadership rubric.
 *
 * This page exists so that no part of how members are assessed is hidden from
 * them. A rubric that decides advancement but stays secret is a performance
 * review with a concealed scale — and it always leaks eventually, at which point
 * the trust cost is retroactive.
 *
 * ---------------------------------------------------------------------------
 * This page changed the most when hours were removed, and had to
 * ---------------------------------------------------------------------------
 *
 * It used to open with "10–16 hours a week" as its headline and print the four
 * commitment tiers as a ladder, read live from `club_settings` so a Co-Lead
 * could move the bar without a deploy. All of it is gone.
 *
 * Leaving a stale rubric here would have been the worst single outcome of the
 * change: this is the page a member reads to find out what the club expects of
 * them, so a bar that nothing is measured against any more is not a cosmetic
 * problem — it is the app misstating the terms of membership. There is now no
 * hours figure published anywhere, because there is no hours figure.
 *
 * The page still says what the club asks for. It asks for finished work.
 *
 * No longer `async`: it read `getClubTiers()` and now reads nothing.
 */
export default function HowWeLeadPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        label="How We Work"
        title="Expectations & leadership"
        description="What we ask of you, how contribution is tracked, and how leads are chosen. Nothing here is hidden."
      />

      <Card>
        <CardBody>
          <SectionLabel>The Commitment</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Finish what you take on
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            SkyRunners builds real aircraft, which takes real time — but the
            club counts no hours and sets no quota. We ask two things: finish
            the deliverables you take on, and say where they stand twice a week.
          </p>

          <div className="rounded-tile bg-surface mt-5 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                We used to count hours. We stopped.
              </span>{" "}
              A timesheet measured the wrong thing: you can sit in the lab for
              twelve hours and ship nothing, and you can solve the problem on
              the walk home. Deliverables finished, and being honest about
              blockers, are what the club actually needs — so those are what it
              looks at.
            </p>
          </div>

          <div className="rounded-tile bg-surface mt-3 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                Log what you did, not how long.
              </span>{" "}
              A line a day is enough, and it is not paperwork: your twice-weekly
              check-in writes itself from those lines, and only asks you to
              write about a project you logged nothing against.
            </p>
          </div>

          <div className="rounded-tile bg-surface mt-3 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                Quarters get heavy.
              </span>{" "}
              Midterms happen to everyone. If you need to step back, set an
              academic pause — nothing counts against you while it&apos;s on,
              and there&apos;s no backlog waiting when you return. We would much
              rather you pause than disappear.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>What Gets Tracked</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Three numbers, no score
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Your Lead and the REs of your projects see exactly what you see on
            My Work: deliverables finished, updates on time, and the roles you
            hold. There is deliberately no combined score and no leaderboard — a
            single number becomes something to game, and flattens the context
            that matters.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "Deliverables finished",
                body: "The one that counts most. Finished work is the only thing that can't be faked.",
              },
              {
                title: "Updates on time",
                body: "Twice a week, on days you pick. Being predictable is what lets others rely on you.",
              },
              {
                title: "Roles held",
                body: "Reported separately, never blended in — otherwise the people already chosen would always look best.",
              },
              {
                title: "Not your hours",
                body: "No timesheet, no weekly quota, no tier. Your work log records what you did, not how long it took.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-tile border-line border px-4 py-3.5"
              >
                <p className="text-ink text-[15px] font-bold">{item.title}</p>
                <p className="text-ink-soft mt-1 text-sm">{item.body}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>Becoming An RE Or Lead</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            What we actually look for
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            In order. The first one outweighs the rest.
          </p>

          <ol className="mt-5 space-y-3">
            {LEADERSHIP_RUBRIC.map((row, i) => (
              <li
                key={row.signal}
                className="rounded-tile border-line flex gap-4 border px-4 py-3.5"
              >
                <span className="bg-cardinal-50 text-cardinal-600 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                  {i + 1}
                </span>
                <div>
                  <p className="text-ink text-[15px] font-bold">{row.signal}</p>
                  <p className="text-ink-soft mt-0.5 text-sm">{row.what}</p>
                  <p className="text-ink-muted mt-1.5 text-sm">{row.why}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>Joining A Project</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            See everything. Ask the RE.
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Every project is open for you to read: its phase, who&apos;s on it,
            what each person owns, what&apos;s blocked, and who the Responsible
            Engineer is. You never have to ask a Co-Lead what&apos;s going on.
          </p>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            To actually join, hit{" "}
            <span className="text-ink font-semibold">Ask to join</span> and say
            what interests you. The RE decides, because they&apos;re accountable
            for the deliverable and they know what the project needs.
            There&apos;s no limit on how many projects you can be on —
            that&apos;s between you and the REs.
          </p>
          <div className="rounded-tile bg-surface mt-5 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                Your request won&apos;t disappear.
              </span>{" "}
              It shows up in the RE&apos;s queue, you can see it&apos;s pending,
              and if nobody answers within five days it gets flagged so a
              Co-Lead can step in. Waiting on a reply should never be the reason
              you have nothing to do.
            </p>
          </div>
          <p className="text-ink-soft mt-4 max-w-2xl text-[15px]">
            You can also <span className="text-ink font-semibold">follow</span>{" "}
            any number of projects to keep an eye on them, with no obligations
            attached.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
