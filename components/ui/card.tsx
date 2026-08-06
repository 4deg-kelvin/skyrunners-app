import { cn } from "@/lib/utils";

/**
 * The base surface of the whole app: white, hairline border, generous radius.
 * Almost every block of content sits in one of these.
 */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-card",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("p-6 sm:p-7", className)}>{children}</div>;
}

/** Hairline divider used between stacked label/value pairs. */
export function CardDivider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line-soft", className)} />;
}
