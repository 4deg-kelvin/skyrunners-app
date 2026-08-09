import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import {
  LEADERSHIP_RUBRIC,
  TIER_LABELS,
  tierDescriptions,
  tierThresholds,
} from "@/lib/contribution";
import { getClubTiers } from "@/lib/data/settings";
import { TIER_TONES } from "@/lib/labels";

/**
 * The published expectations and leadership rubric.
 *
 * This page exists so that no part of how members are assessed is hidden from
 * them. A rubric that decides advancement but stays secret is a performance
 * review with a concealed scale — and it always leaks eventually, at which point
 * the trust cost is retroactive.
 */
export default async function HowWeLeadPage() {
  /*
    Read, never hard-coded.

    This page is the published rubric — it exists so nothing about how members
    are assessed is hidden from them. The numbers used to be constants printed
    here, so the first time a Co-Lead moved the bar this page would have gone
    on stating the old one. A rubric that doesn't match what leadership
    actually uses is worse than no rubric.
  */
  const tiers = await getClubTiers();
  const descriptions = tierDescriptions(tiers);

  return (
    <div className="space-y-6">
      <PageHeader
        label="How We Work"
        title="Expectations & leadership"
        description="What the team asks of you, how contribution is tracked, and what we look for when choosing leads. Nothing here is hidden from anyone."
      />

      <Card>
        <CardBody>
          <SectionLabel>The Commitment</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            {tiers.minimum}–{tiers.core} hours a week
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            SkyRunners builds real aircraft, and that takes real time. The
            expectation is {tiers.minimum}–{tiers.core} hours a week, and plenty
            of people go further. We say this up front so you can decide whether
            it fits your quarter — not discover it in week six.
          </p>

          <div className="mt-6 space-y-2.5">
            {tierThresholds(tiers).map(({ tier, minHoursPerWeek }) => (
              <div
                key={tier}
                className="rounded-tile border-line flex flex-wrap items-center gap-3 border px-4 py-3"
              >
                <Badge tone={TIER_TONES[tier]}>{TIER_LABELS[tier]}</Badge>
                <span className="text-ink text-sm font-semibold">
                  {minHoursPerWeek}+ hrs/week
                </span>
                <span className="text-ink-soft text-sm">
                  {descriptions[tier]}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-tile bg-surface mt-5 px-4 py-3.5">
            <p className="text-ink-soft text-sm">
              <span className="text-ink font-semibold">
                These are rungs, not grades.
              </span>{" "}
              Quarters get heavy, and midterms happen to everyone. If you need
              to step back, set an academic pause — nothing counts against you
              while it&apos;s on, and there&apos;s no backlog waiting when you
              return. We would much rather you pause than disappear.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SectionLabel>What Gets Tracked</SectionLabel>
          <h2 className="text-ink mt-2 text-2xl font-bold">
            Four numbers, no score
          </h2>
          <p className="text-ink-soft mt-3 max-w-2xl text-[15px]">
            Your Lead and the REs of your projects see exactly what you see on
            My Work: deliverables finished, hours per week, updates on time, and
            the roles you hold. There is deliberately no combined score and no
            leaderboard — a single number would just become something to game,
            and it would flatten context that matters.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "Deliverables finished",
                body: "The one that counts most. Finished work is the only thing that can't be faked.",
              },
              {
                title: "Hours per week",
                body: "Context, not achievement. Twelve hours with nothing shipped isn't a strong quarter.",
              },
              {
                title: "Updates on time",
                body: "Twice a week, on days you pick. Being predictable is what lets others rely on you.",
              },
              {
                title: "Roles held",
                body: "Reported separately, never blended in — otherwise the people already chosen would always look best.",
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
            Every project in the club is open for you to read: what phase
            it&apos;s in, who&apos;s on it, what each person owns, what&apos;s
            blocked, and who the Responsible Engineer is. Nothing about the work
            is hidden, and you never have to ask a Co-Lead what&apos;s going on.
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
