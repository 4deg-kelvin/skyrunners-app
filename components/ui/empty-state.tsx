import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Empty states always offer a next action.
 *
 * A new member should never hit a dead end that doesn't tell them what to do —
 * that's the "productive in five minutes" principle applied at the component
 * level, and it's why `actionLabel` and `actionHref` are required rather than
 * optional.
 */
export function EmptyState({
  message,
  actionLabel,
  actionHref,
  className,
}: {
  message: string;
  actionLabel: string;
  actionHref: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-tile border-line border border-dashed px-4 py-6 text-center",
        className
      )}
    >
      <p className="text-ink-soft text-sm">{message}</p>
      <Link
        href={actionHref}
        className="text-cardinal-600 hover:text-cardinal-700 mt-2 inline-block text-sm font-semibold"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
