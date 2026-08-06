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
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-tile border border-line px-5 py-4",
        className
      )}
    >
      <FieldLabel className="mb-1.5 normal-case tracking-normal text-[13px] font-medium">
        {label}
      </FieldLabel>
      <p className="text-xl font-bold text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
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
      <div className="text-[15px] font-bold text-ink">{children}</div>
    </div>
  );
}
