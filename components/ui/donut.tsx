/**
 * Thick-ring progress donut, matching the "92% spent" figure in the
 * reference design.
 *
 * Hand-rolled SVG rather than a chart library: it's ~30 lines, has no
 * dependencies, and renders on the server with no hydration cost.
 */
export function Donut({
  fraction,
  label,
  size = 132,
  thickness = 18,
}: {
  /** 0 to 1 */
  fraction: number;
  label: string;
  size?: number;
  thickness?: number;
}) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * clamped;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped * 100)}% ${label}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-cardinal-600)"
          strokeWidth={thickness}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none text-ink">
          {Math.round(clamped * 100)}%
        </span>
        <span className="mt-1 text-xs text-ink-muted">{label}</span>
      </div>
    </div>
  );
}
