import { cn } from "@/lib/utils";

export type BadgeTone = "ok" | "warn" | "risk" | "neutral" | "cardinal";

const toneStyles: Record<BadgeTone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  warn: "bg-warn-bg text-warn-fg",
  risk: "bg-risk-bg text-risk-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  cardinal: "bg-cardinal-600 text-white",
};

/** Rounded pill status chip, e.g. the green "Open now" in the reference. */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        toneStyles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
