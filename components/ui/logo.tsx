/**
 * The club's mark: a top-down quadcopter.
 *
 * Same geometry as `app/icon.svg`, which is the favicon — deliberately, so the
 * browser tab and the header are the same object rather than two things that
 * nearly match. If you change one, change both.
 *
 * Top-down rather than a side-view aircraft because the mark has to survive
 * 16px in a tab strip, where a silhouette becomes an indistinct sliver. Four
 * rotors in a square is legible at any size and reads as "drone" instantly.
 *
 * Inherits `currentColor`, so it takes the colour of whatever it sits in — a
 * white mark on the cardinal circle in the header, cardinal on white elsewhere.
 */
export function DroneMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <g strokeWidth={2.4}>
        <path d="M10.5 10.5 L21.5 21.5" />
        <path d="M21.5 10.5 L10.5 21.5" />
      </g>
      <g strokeWidth={2}>
        <circle cx="9" cy="9" r="3.6" />
        <circle cx="23" cy="9" r="3.6" />
        <circle cx="9" cy="23" r="3.6" />
        <circle cx="23" cy="23" r="3.6" />
      </g>
      <circle cx="16" cy="16" r="3.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
