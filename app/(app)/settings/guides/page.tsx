import Link from "next/link";
import { redirect } from "next/navigation";
import { Info } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { GuideEditor } from "@/components/forms/guide-editor";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { getGuideBlocks } from "@/lib/data/guides";
import { getViewer } from "@/lib/data/viewer";
import { can } from "@/lib/permissions";

export const metadata = {
  title: "Edit the guides",
};

/**
 * Where a Co-Lead edits the two guide pages.
 *
 * Its own route rather than another card on Settings, because Settings is
 * already carrying the profile, check-in days, the pause, the AI connection,
 * the tiers, the academic calendar and the trainings catalogue. Adding a
 * two-page content editor to that would make the page unreadable for the
 * member who came to change their phone number.
 */
export default async function EditGuidesPage() {
  const viewer = await getViewer();

  /*
    The gate. Hiding the link is not access control — this route is reachable
    by URL, and it writes the club's official onboarding.
  */
  if (!can.manageGuides(viewer.actor)) redirect("/settings");

  const [newHere, leading] = await Promise.all([
    getGuideBlocks("getting_started"),
    getGuideBlocks("leading"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        label="Co-Lead"
        title="Edit the guides"
        description="Add the club's own material to the two guide pages — setup docs, shop rules, templates. Links to Google Docs work well; short notes are for anything the app itself doesn't explain."
      />

      {/*
        The line between what is editable and what isn't, said once, plainly.
        Without it the obvious question on this page is "why can't I change the
        rest of it", and the answer is a real design decision rather than an
        oversight.
      */}
      <Card className="border-cardinal-200 bg-cardinal-50">
        <CardBody className="py-4">
          <p className="text-ink-soft flex items-start gap-2 text-sm">
            <Info className="text-cardinal-600 mt-0.5 size-4 shrink-0" />
            <span>
              <span className="text-ink font-semibold">
                What you can edit here:
              </span>{" "}
              the club&apos;s own material — how to install Fusion, where the
              shop rules live, what you expect of a Lead this quarter. The rest
              of those pages explains how <em>this app</em> works, and stays in
              the code so it can&apos;t drift out of date the next time a
              feature changes. If something built-in is wrong, that&apos;s a bug
              worth reporting rather than a page to rewrite.
            </span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel>New Here?</SectionLabel>
              <h2 className="text-ink mt-2 text-2xl font-bold">
                The new member guide
              </h2>
              <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
                Shown after the club&apos;s expectations, near the bottom of the
                page. The natural home for &ldquo;how to set up Fusion&rdquo; or
                &ldquo;how to get into the shop&rdquo;.
              </p>
            </div>
            <Link
              href="/getting-started"
              className="text-cardinal-600 hover:text-cardinal-700 shrink-0 text-sm font-semibold"
            >
              View the page →
            </Link>
          </div>
          <div className="mt-5">
            <GuideEditor page="getting_started" rows={newHere} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionLabel>Leading Here</SectionLabel>
              <h2 className="text-ink mt-2 text-2xl font-bold">
                The Lead guide
              </h2>
              <p className="text-ink-soft mt-2 max-w-2xl text-[15px]">
                Shown at the bottom of the page an RE or Lead reads. Use it for
                what the club expects of them beyond what the app enforces —
                chasing check-ins, running a design review, handing a project
                over.
              </p>
            </div>
            <Link
              href="/leading"
              className="text-cardinal-600 hover:text-cardinal-700 shrink-0 text-sm font-semibold"
            >
              View the page →
            </Link>
          </div>
          <div className="mt-5">
            <GuideEditor page="leading" rows={leading} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
