import { cn } from "@/lib/utils";
import { FieldLabel } from "./section-label";

/**
 * Bordered tile with a small gray label above a large bold value.
 * The reference uses a row of these for "Annual cycle / Total budget /
 * Spent so far".
 */
export function StatTile({
  label,
  value,
  hint,
  action,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /**
   * A control for the thing this tile shows, on the label row.
   *
   * The house pattern, and the reason it's a slot here rather than a button
   * somebody drops in beside the tile: **the control lives on the thing it
   * changes.** Discord verification sits on the Discord ID field for exactly
   * this reason — it used to have its own card, and the commonest question it
   * produced ("I pasted my ID, why does it still say not connected?") was
   * answered two inches further down the page where nobody looked.
   *
   * A "Push the deadline" button floating next to a row of tiles has the same
   * problem in reverse: nothing says which of the three numbers it moves.
   */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-tile border-line border px-5 py-4", className)}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <FieldLabel className="text-[13px] font-medium tracking-normal normal-case">
          {label}
        </FieldLabel>
        {/*
          `shrink-0` so a long label wraps rather than squeezing the control to
          nothing — the tiles sit in a 3-up grid that gets narrow on a phone.
        */}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <p className="text-ink text-xl font-bold">{value}</p>
      {hint ? <div className="text-ink-muted mt-1 text-xs">{hint}</div> : null}
    </div>
  );
}

/** Stacked label/value pair with a divider, as in the left summary column. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <FieldLabel className="mb-1.5">{label}</FieldLabel>
      <div className="text-ink text-[15px] font-bold">{children}</div>
    </div>
  );
}
