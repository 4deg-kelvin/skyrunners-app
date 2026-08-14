import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * The banner card at the top of every page: small cardinal label, large
 * heading, one-line description, and an optional primary action on the right.
 * Matches the "LEAD PORTAL / Dashboard" block in the reference design.
 */
export function PageHeader({
  label,
  title,
  description,
  action,
}: {
  label: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <SectionLabel>{label}</SectionLabel>
          <h1 className="text-ink mt-2 text-4xl font-bold">{title}</h1>
          {description ? (
            <p className="text-ink-soft mt-2 text-[15px]">{description}</p>
          ) : null}
        </div>
        {/*
          `shrink-0` keeps a BUTTON from being squashed, which is what this slot
          was built for. But two callers put a whole FORM in here — the calendar's
          "Add to calendar" and the projects page's create form — and `shrink-0`
          then let the form set its own natural width and push the page sideways:
          872px inside a 691px viewport, 277px of horizontal overflow.

          `min-w-0 max-w-full` caps it at the container without touching the button
          case, since a button is narrower than the container anyway and never hits
          the ceiling. `min-w-0` is the half that lets the form's inner grid columns
          actually give way — the same pair that fixed the roster overflow in
          docs/HANDOFF.md.
        */}
        {action ? (
          <div className="max-w-full min-w-0 shrink-0">{action}</div>
        ) : null}
      </CardBody>
    </Card>
  );
}
