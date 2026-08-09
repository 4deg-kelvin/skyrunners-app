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
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardBody>
    </Card>
  );
}
