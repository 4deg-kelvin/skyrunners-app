import { cn } from "@/lib/utils";

/**
 * The small uppercase cardinal-red label that sits above every section
 * heading in the reference design ("LEAD PORTAL", "TEAM SUMMARY",
 * "OPERATIONS", "REPORT DUE").
 *
 * These do a lot of the visual work — they orient the reader before they
 * read the heading, which is exactly what a new member needs.
 */
export function SectionLabel({
  children,
  className,
  tone = "cardinal",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "cardinal" | "muted";
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-semibold tracking-[0.1em] uppercase",
        tone === "cardinal" ? "text-cardinal-600" : "text-ink-muted",
        className
      )}
    >
      {children}
    </p>
  );
}

/** Small gray label used above a value inside a stat tile or detail row. */
export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-ink-muted text-[11px] font-semibold tracking-[0.09em] uppercase",
        className
      )}
    >
      {children}
    </p>
  );
}
