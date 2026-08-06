import { Card, CardBody } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * A 404 that offers a way forward, per the design rule that no dead end should
 * leave someone without a next action.
 */
export default function NotFound() {
  return (
    <Card>
      <CardBody className="py-12 text-center">
        <SectionLabel>Not Found</SectionLabel>
        <h1 className="mt-3 text-3xl font-bold text-ink">
          We couldn&apos;t find that page
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-soft">
          The link may be out of date, or the project or member may have been
          archived.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/my-work">Go to My Work</ButtonLink>
          <ButtonLink href="/projects" variant="secondary">
            Browse projects
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
