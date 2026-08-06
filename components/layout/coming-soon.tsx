import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * Placeholder for pages whose build phase hasn't started yet.
 * Says what's coming and which phase it lands in, so the nav is never a
 * dead end during development.
 */
export function ComingSoon({
  phase,
  items,
}: {
  phase: string;
  items: string[];
}) {
  return (
    <Card>
      <CardBody>
        <SectionLabel>{phase}</SectionLabel>
        <h2 className="mt-2 text-xl font-bold text-ink">Not built yet</h2>
        <p className="mt-2 text-[15px] text-ink-soft">
          This page arrives in {phase}. Planned:
        </p>
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2.5 text-[15px] text-ink-soft">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cardinal-600" />
              {item}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
